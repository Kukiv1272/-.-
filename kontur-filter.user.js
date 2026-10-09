// ==UserScript==
// @name         Фильтр запрещённых слов для Контур.Толка
// @namespace    https://example.local/
// @version      2.6
// @description  Блокирует сообщения с запрещёнными словами
// @match        https://talk.kontur.ru/*
// @match        https://*.talk.kontur.ru/*
// @match        https://*.ktalk.ru/*
// @downloadURL  https://raw.githubusercontent.com/Kukiv1272/-.-/refs/heads/main/kontur-filter.user.js
// @updateURL    https://raw.githubusercontent.com/Kukiv1272/-.-/refs/heads/main/kontur-filter.user.js
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    // ОСТАВЬ ЗДЕСЬ СВОЙ ТЕКУЩИЙ URL GOOGLE APPS SCRIPT
    const WORDS_API_URL =
        'https://script.google.com/macros/s/AKfycbxiJq8rcHC6gotGHqqix-LY1DfR50S1zzuRGUb3vS0V_ksMMC78aqjbExjq5aJSLHBwrg/exec?key=sdkjlfbbndmbhki;ddmjhhkmsdfgokapdfjkkggdjfgiad;fg2395klsdfgdfgmjdjf';

    const REFRESH_INTERVAL = 5 * 60 * 1000;

    const FIELD_SELECTOR =
        'textarea.area[placeholder="Отправить сообщение"]';

    const SEND_BUTTON_SELECTOR =
        'button[type="submit"][aria-label="Отправить"]';

    let forbiddenWords = [];
    let wordsLoaded = false;
    let wordsLoadError = false;

    let warningElement = null;
    let warningTimer = null;

    const attachedFields = new WeakSet();
    const attachedButtons = new WeakSet();
    const attachedForms = new WeakSet();


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
        if (!(element instanceof Element)) {
            return false;
        }

        const style =
            window.getComputedStyle(element);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.getClientRects().length > 0
        );
    }


    function parseWords(items) {
        return [
            ...new Set(
                items
                    .flatMap(item =>
                        String(item)
                            .split(/[\s,;]+/)
                            .map(normalizeText)
                            .filter(Boolean)
                    )
            )
        ];
    }


    function loadForbiddenWords() {
        const separator =
            WORDS_API_URL.includes('?') ? '&' : '?';

        GM_xmlhttpRequest({
            method: 'GET',

            url:
                WORDS_API_URL +
                separator +
                '_=' +
                Date.now(),

            onload(response) {
                try {
                    const data =
                        JSON.parse(response.responseText);

                    if (data.error) {
                        throw new Error(data.error);
                    }

                    if (!Array.isArray(data.words)) {
                        throw new Error(
                            'В ответе нет массива words'
                        );
                    }

                    forbiddenWords =
                        parseWords(data.words);

                    wordsLoaded = true;
                    wordsLoadError = false;

                    console.log(
                        '[Фильтр] Загружено слов:',
                        forbiddenWords.length
                    );

                    console.log(
                        '[Фильтр] Есть слово 1:',
                        forbiddenWords.includes('1')
                    );
                } catch (error) {
                    wordsLoadError = true;

                    console.error(
                        '[Фильтр] Ошибка списка слов:',
                        error
                    );
                }
            },

            onerror(error) {
                wordsLoadError = true;

                console.error(
                    '[Фильтр] Ошибка загрузки:',
                    error
                );
            }
        });
    }


    function findForbiddenWord(text) {
        const message =
            normalizeText(text);

        for (const word of forbiddenWords) {
            const escapedWord =
                escapeRegExp(word)
                    .replace(/\s+/g, '\\s+');

            const regexp =
                new RegExp(
                    `(^|[^\\p{L}\\p{N}_])` +
                    escapedWord +
                    `($|[^\\p{L}\\p{N}_])`,
                    'iu'
                );

            if (regexp.test(message)) {
                return word;
            }
        }

        return null;
    }


    function getFieldForElement(element) {
        if (!(element instanceof Element)) {
            return null;
        }

        if (element.matches(FIELD_SELECTOR)) {
            return element;
        }

        const containers = [
            element.closest('.text'),
            element.closest('.chat-message-area'),
            element.closest('form')
        ].filter(Boolean);

        for (const container of containers) {
            const fields = [
                ...container.querySelectorAll(FIELD_SELECTOR)
            ].filter(isVisible);

            if (!fields.length) {
                continue;
            }

            const activeField =
                fields.find(
                    field => field === document.activeElement
                );

            if (activeField) {
                return activeField;
            }

            const filledField =
                fields.find(
                    field => String(field.value || '').trim()
                );

            return filledField || fields[0];
        }

        const activeField =
            document.activeElement instanceof Element &&
            document.activeElement.matches(FIELD_SELECTOR) &&
            isVisible(document.activeElement)
                ? document.activeElement
                : null;

        if (activeField) {
            return activeField;
        }

        return [
            ...document.querySelectorAll(FIELD_SELECTOR)
        ].find(isVisible) || null;
    }


    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }


    function showWarning(message) {
        if (!document.body) {
            return;
        }

        if (warningElement) {
            warningElement.remove();
        }

        clearTimeout(warningTimer);

        warningElement =
            document.createElement('div');

        warningElement.textContent =
            message;

        Object.assign(warningElement.style, {
            position: 'fixed',
            left: '50%',
            bottom: '30px',
            transform: 'translateX(-50%)',
            zIndex: '2147483647',
            padding: '12px 18px',
            background: '#b00020',
            color: '#ffffff',
            borderRadius: '8px',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            boxShadow: '0 4px 15px rgba(0, 0, 0, .3)'
        });

        document.body.appendChild(warningElement);

        warningTimer =
            setTimeout(() => {
                warningElement?.remove();
                warningElement = null;
            }, 4500);
    }


    function checkMessage(event, source) {
        const field =
            source instanceof Element &&
            source.matches(FIELD_SELECTOR)
                ? source
                : getFieldForElement(source);

        if (!field) {
            return;
        }

        if (!wordsLoaded) {
            stopEvent(event);

            showWarning(
                wordsLoadError
                    ? 'Не удалось загрузить список запрещённых слов.'
                    : 'Список запрещённых слов ещё загружается.'
            );

            return;
        }

        const forbiddenWord =
            findForbiddenWord(field.value);

        if (!forbiddenWord) {
            return;
        }

        stopEvent(event);

        showWarning(
            `Сообщение не отправлено. ` +
            `Найдено запрещённое слово: «${forbiddenWord}»`
        );

        field.focus();
    }


    function attachField(field) {
        if (attachedFields.has(field)) {
            return;
        }

        attachedFields.add(field);

        const handleKey = event => {
            if (
                event.key === 'Enter' &&
                !event.shiftKey
            ) {
                checkMessage(event, field);
            }
        };

        field.addEventListener(
            'keydown',
            handleKey,
            true
        );

        field.addEventListener(
            'keypress',
            handleKey,
            true
        );

        console.log(
            '[Фильтр] Подключено поле:',
            field
        );
    }


    function attachButton(button) {
        if (attachedButtons.has(button)) {
            return;
        }

        attachedButtons.add(button);

        const handleSend = event => {
            checkMessage(event, button);
        };

        button.addEventListener(
            'click',
            handleSend,
            true
        );

        button.addEventListener(
            'pointerdown',
            handleSend,
            true
        );

        console.log(
            '[Фильтр] Подключена кнопка:',
            button
        );
    }


    function attachForm(form) {
        if (attachedForms.has(form)) {
            return;
        }

        attachedForms.add(form);

        form.addEventListener(
            'submit',
            event => {
                checkMessage(event, form);
            },
            true
        );
    }


    function attachHandlers(root) {
        if (!root || !root.querySelectorAll) {
            return;
        }

        root.querySelectorAll(
            FIELD_SELECTOR
        ).forEach(attachField);

        root.querySelectorAll(
            SEND_BUTTON_SELECTOR
        ).forEach(attachButton);

        root.querySelectorAll(
            'form'
        ).forEach(attachForm);
    }


    function startObserver() {
        attachHandlers(document);

        const observer =
            new MutationObserver(() => {
                attachHandlers(document);
            });

        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );

        console.log(
            '[Фильтр] Наблюдение за плавающими окнами включено'
        );
    }


    loadForbiddenWords();

    setInterval(
        loadForbiddenWords,
        REFRESH_INTERVAL
    );

    window.addEventListener(
        'focus',
        loadForbiddenWords
    );

    document.addEventListener(
        'visibilitychange',
        () => {
            if (!document.hidden) {
                loadForbiddenWords();
            }
        }
    );

    if (document.documentElement) {
        startObserver();
    } else {
        document.addEventListener(
            'DOMContentLoaded',
            startObserver,
            { once: true }
        );
    }
})();
