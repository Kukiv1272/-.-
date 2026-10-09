(() => {
    'use strict';

    const FIELD_SELECTOR = [
        'textarea.area[placeholder="Отправить сообщение"]',
        'textarea.area[placeholder="Быстрое сообщение"]'
    ].join(',');

    const BUTTON_SELECTOR =
        'button[type="submit"][aria-label="Отправить"]';

    const REFRESH_INTERVAL = 2 * 60 * 1000;

    let forbiddenWords = [];
    let wordsLoaded = false;
    let wordsLoadError = false;

    const attachedFields = new WeakSet();
    const attachedButtons = new WeakSet();
    const attachedForms = new WeakSet();

    const bypassButtons = new WeakSet();
    const bypassForms = new WeakSet();
    const pendingFields = new WeakSet();

    let warning = null;
    let warningTimer = null;

    function normalizeText(text) {
        return String(text || '')
            .normalize('NFKC')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase('ru-RU');
    }

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function isVisible(element) {
        const style = getComputedStyle(element);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.getClientRects().length > 0
        );
    }

    function requestWords(force = false) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'getWords', force },
                response => {
                    if (chrome.runtime.lastError) {
                        wordsLoadError = true;
                        const message = chrome.runtime.lastError.message;
                        console.error('[Контур-фильтр]', message);
                        reject(new Error(message));
                        return;
                    }

                    if (!response?.ok) {
                        wordsLoadError = true;
                        const message =
                            response?.error || 'Неизвестная ошибка';
                        console.error('[Контур-фильтр]', message);
                        reject(new Error(message));
                        return;
                    }

                    forbiddenWords = Array.isArray(response.words)
                        ? response.words.map(normalizeText).filter(Boolean)
                        : [];

                    wordsLoaded = true;
                    wordsLoadError = false;
                    resolve(forbiddenWords);
                }
            );
        });
    }

    function getField(source) {
        if (!(source instanceof Element)) {
            return null;
        }

        if (source.matches(FIELD_SELECTOR)) {
            return source;
        }

        const containers = [
            source.closest('.text'),
            source.closest('.chat-message-area'),
            source.closest('form')
        ].filter(Boolean);

        for (const container of containers) {
            const fields = [...container.querySelectorAll(FIELD_SELECTOR)]
                .filter(isVisible);

            if (!fields.length) {
                continue;
            }

            return fields.find(field => field === document.activeElement) ||
                fields.find(field => String(field.value || '').trim()) ||
                fields[0];
        }

        return [...document.querySelectorAll(FIELD_SELECTOR)]
            .filter(isVisible)
            .find(field => field === document.activeElement) ||
            [...document.querySelectorAll(FIELD_SELECTOR)]
                .filter(isVisible)[0] ||
            null;
    }

    function getForm(element) {
        return element instanceof Element
            ? element.closest('form')
            : null;
    }

    function getSendButton(field, source) {
        const containers = [
            field?.closest('.text'),
            field?.closest('.chat-message-area'),
            getForm(source),
            getForm(field),
            source instanceof Element
                ? source.closest('.chat-message-area')
                : null
        ].filter(Boolean);

        for (const container of containers) {
            const button = [...container.querySelectorAll(BUTTON_SELECTOR)]
                .find(isVisible);

            if (button) {
                return button;
            }
        }

        return [...document.querySelectorAll(BUTTON_SELECTOR)]
            .filter(isVisible)
            .find(button => {
                const buttonArea = button.closest('.chat-message-area');
                return (
                    buttonArea &&
                    field?.closest('.chat-message-area') === buttonArea
                );
            }) || null;
    }

    function findForbiddenWords(text) {
        const message = normalizeText(text);
        const found = [];

        for (const word of forbiddenWords) {
            const pattern = escapeRegExp(word);
            const regexp = new RegExp(
                `(^|[^\p{L}\p{N}_])${pattern}($|[^\p{L}\p{N}_])`,
                'iu'
            );

            if (regexp.test(message)) {
                found.push(word);
            }
        }

        return [...new Set(found)];
    }

    function showWarning(message, backgroundColor = '#b00020') {
        warning?.remove();
        clearTimeout(warningTimer);

        warning = document.createElement('div');
        warning.textContent = message;

        Object.assign(warning.style, {
            position: 'fixed',
            left: '50%',
            bottom: '30px',
            transform: 'translateX(-50%)',
            zIndex: '2147483647',
            padding: '12px 18px',
            background: backgroundColor,
            color: '#fff',
            borderRadius: '8px',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            boxShadow: '0 4px 15px rgba(0,0,0,.3)'
        });

        document.body?.appendChild(warning);

        warningTimer = setTimeout(() => {
            warning?.remove();
            warning = null;
        }, 4500);
    }

    chrome.runtime.onMessage.addListener(message => {
        if (message?.type !== 'updateAvailable') {
            return;
        }

        showWarning(
            `Доступно обновление ${message.version}. Нажмите на значок расширения.`,
            '#188038'
        );
    });

    function stop(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    function consume(set, element) {
        if (!element || !set.has(element)) {
            return false;
        }

        set.delete(element);
        return true;
    }

    function replayAllowedSend(field, source) {
        const form = getForm(source) || getForm(field);
        const button = getSendButton(field, source);

        if (form) {
            bypassForms.add(form);
        }

        if (button) {
            bypassButtons.add(button);
            button.click();
            return;
        }

        if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit();
            return;
        }

        showWarning(
            'Список обновлён, но кнопку отправки не удалось найти.'
        );
    }

    async function check(event, source) {
        if (source instanceof Element && source.matches(BUTTON_SELECTOR)) {
            if (consume(bypassButtons, source)) {
                return;
            }
        }

        if (source instanceof HTMLFormElement && consume(bypassForms, source)) {
            return;
        }

        const field = getField(source);

        if (!field) {
            return;
        }

        if (pendingFields.has(field)) {
            stop(event);
            return;
        }

        pendingFields.add(field);
        stop(event);

        try {
            if (!wordsLoaded) {
                requestWords(false).catch(() => {});
                showWarning(
                    wordsLoadError
                        ? 'Не удалось загрузить список запрещённых слов.'
                        : 'Список запрещённых слов ещё загружается.'
                );
                return;
            }

            requestWords(false).catch(() => {});

            const hits = findForbiddenWords(field.value);

            if (hits.length) {
                showWarning(
                    `Сообщение не отправлено. Найдены слова: ${hits
                        .map(word => `«${word}»`)
                        .join(', ')}`
                );
                field.focus();
                return;
            }

            replayAllowedSend(field, source);
        } catch (error) {
            showWarning(
                'Не удалось загрузить список запрещённых слов.'
            );
            console.error('[Контур-фильтр] Проверка перед отправкой:', error);
        } finally {
            pendingFields.delete(field);
        }
    }

    function attachField(field) {
        if (attachedFields.has(field)) {
            return;
        }

        attachedFields.add(field);

        field.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) {
                check(event, field);
            }
        }, true);

        console.log('[Контур-фильтр] Подключено поле', field);
    }

    function attachButton(button) {
        if (attachedButtons.has(button)) {
            return;
        }

        attachedButtons.add(button);

        button.addEventListener('click', event => {
            check(event, button);
        }, true);

        console.log('[Контур-фильтр] Подключена кнопка', button);
    }

    function attachForm(form) {
        if (attachedForms.has(form)) {
            return;
        }

        attachedForms.add(form);
        form.addEventListener('submit', event => check(event, form), true);
    }

    function scan() {
        document.querySelectorAll(FIELD_SELECTOR).forEach(attachField);
        document.querySelectorAll(BUTTON_SELECTOR).forEach(attachButton);
        document.querySelectorAll('form').forEach(attachForm);
    }

    function start() {
        scan();

        const observer = new MutationObserver(scan);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        console.log('[Контур-фильтр] Запущен, адрес:', location.href);
    }

    requestWords(false).catch(() => {});
    setInterval(
        () => requestWords(true).catch(() => {}),
        REFRESH_INTERVAL
    );

    document.addEventListener(
        'visibilitychange',
        () => {
            if (!document.hidden) {
                requestWords(true).catch(() => {});
            }
        }
    );

    if (document.documentElement) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
