// ==UserScript==
// @name         Фильтр запрещённых слов для Контур.Толка
// @namespace    https://example.local/
// @version      3.0
// @description  Блокирует сообщения в основном и плавающем окне
// @match        https://talk.kontur.ru/*
// @match        https://*.talk.kontur.ru/*
// @match        https://*.ktalk.ru/*
// @downloadURL  https://github.com/Kukiv1272/kontur-filter/raw/refs/heads/main/kontur-filter.user.js
// @updateURL    https://github.com/Kukiv1272/kontur-filter/raw/refs/heads/main/kontur-filter.user.js
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const WORDS_API_URL =
        'https://script.google.com/macros/s/AKfycbxiJq8rcHC6gotGHqqix-LY1DfR50S1zzuRGUb3vS0V_ksMMC78aqjbExjq5aJSLHBwrg/exec?key=sdkjlfbbndmbhki;ddmjhhkmsdfgokapdfjkkggdjfgiad;fg2395klsdfgdfgmjdjf';

    const REFRESH_INTERVAL =
        5 * 60 * 1000;

    const FIELD_SELECTOR =
        'textarea.area[placeholder="Отправить сообщение"]';

    const BUTTON_SELECTOR =
        'button[type="submit"][aria-label="Отправить"]';

    const documentStates =
        new WeakMap();

    let forbiddenWords = [];
    let wordsLoaded = false;
    let wordsLoadError = false;

    let warningElement = null;
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
            WORDS_API_URL.includes('?')
                ? '&'
                : '?';

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
                        '[Фильтр] Слово "1":',
                        forbiddenWords.includes('1')
                    );
                } catch (error) {
                    wordsLoadError = true;

                    console.error(
                        '[Фильтр] Ошибка списка:',
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


    function isVisible(element, doc) {
        if (!(element instanceof Element)) {
            return false;
        }

        const view =
            doc.defaultView || window;

        const style =
            view.getComputedStyle(element);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.getClientRects().length > 0
        );
    }


    function findField(source, doc) {
        if (
            source instanceof Element &&
            source.matches(FIELD_SELECTOR)
        ) {
            return source;
        }

        if (source instanceof Element) {
            const containers = [
                source.closest('.text'),
                source.closest('.chat-message-area'),
                source.closest('form')
            ].filter(Boolean);

            for (const container of containers) {
                const fields = [
                    ...container.querySelectorAll(
                        FIELD_SELECTOR
                    )
                ].filter(field =>
                    isVisible(field, doc)
                );

                if (!fields.length) {
                    continue;
                }

                const activeField =
                    fields.find(
                        field =>
                            field === doc.activeElement
                    );

                if (activeField) {
                    return activeField;
                }

                const filledField =
                    fields.find(
                        field =>
                            String(field.value || '').trim()
                    );

                return filledField || fields[0];
            }
        }

        const activeField =
            doc.activeElement instanceof Element &&
            doc.activeElement.matches(FIELD_SELECTOR) &&
            isVisible(doc.activeElement, doc)
                ? doc.activeElement
                : null;

        if (activeField) {
            return activeField;
        }

        return [
            ...doc.querySelectorAll(FIELD_SELECTOR)
        ].find(field =>
            isVisible(field, doc)
        ) || null;
    }


    function findForbiddenWord(text) {
        const message =
            normalizeText(text);

        for (const word of forbiddenWords) {
            const pattern =
                escapeRegExp(word)
                    .replace(/\s+/g, '\\s+');

            const regexp =
                new RegExp(
                    `(^|[^\\p{L}\\p{N}_])` +
                    pattern +
                    `($|[^\\p{L}\\p{N}_])`,
                    'iu'
                );

            if (regexp.test(message)) {
                return word;
            }
        }

        return null;
    }


    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }


    function showWarning(message, doc) {
        const targetDocument =
            doc || document;

        if (!targetDocument.body) {
            return;
        }

        if (targetDocument === document) {
            warningElement?.remove();
            clearTimeout(warningTimer);
        }

        const warning =
            targetDocument.createElement('div');

        warning.textContent =
            message;

        Object.assign(warning.style, {
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
            boxShadow: '0 4px 15px rgba(0,0,0,.3)'
        });

        targetDocument.body.appendChild(warning);

        if (targetDocument === document) {
            warningElement = warning;

            warningTimer =
                setTimeout(() => {
                    warning.remove();
                    warningElement = null;
                }, 4500);
        } else {
            setTimeout(() => {
                warning.remove();
            }, 4500);
        }
    }


    function checkMessage(event, source, doc) {
        const field =
            findField(source, doc);

        if (!field) {
            return;
        }

        if (!wordsLoaded) {
            stopEvent(event);

            showWarning(
                wordsLoadError
                    ? 'Не удалось загрузить список запрещённых слов.'
                    : 'Список запрещённых слов ещё загружается.',
                doc
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
            `Найдено запрещённое слово: «${forbiddenWord}»`,
            doc
        );

        field.focus();
    }


    function attachDocument(targetDocument, name) {
        if (!targetDocument) {
            return;
        }

        if (documentStates.has(targetDocument)) {
            return;
        }

        const state = {
            fields: new WeakSet(),
            buttons: new WeakSet(),
            forms: new WeakSet()
        };

        documentStates.set(
            targetDocument,
            state
        );

        function attachField(field) {
            if (state.fields.has(field)) {
                return;
            }

            state.fields.add(field);

            const handleKey =
                event => {
                    if (
                        event.key === 'Enter' &&
                        !event.shiftKey
                    ) {
                        checkMessage(
                            event,
                            field,
                            targetDocument
                        );
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
        }


        function attachButton(button) {
            if (state.buttons.has(button)) {
                return;
            }

            state.buttons.add(button);

            const handleSend =
                event => {
                    checkMessage(
                        event,
                        button,
                        targetDocument
                    );
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
        }


        function attachForm(form) {
            if (state.forms.has(form)) {
                return;
            }

            state.forms.add(form);

            form.addEventListener(
                'submit',
                event => {
                    checkMessage(
                        event,
                        form,
                        targetDocument
                    );
                },
                true
            );
        }


        function scan() {
            targetDocument
                .querySelectorAll(FIELD_SELECTOR)
                .forEach(attachField);

            targetDocument
                .querySelectorAll(BUTTON_SELECTOR)
                .forEach(attachButton);

            targetDocument
                .querySelectorAll('form')
                .forEach(attachForm);
        }

        scan();

        if (targetDocument.documentElement) {
            const observer =
                new targetDocument.defaultView.MutationObserver(
                    scan
                );

            observer.observe(
                targetDocument.documentElement,
                {
                    childList: true,
                    subtree: true
                }
            );
        }

        console.log(
            '[Фильтр] Подключено окно:',
            name
        );
    }


    function watchPopup(popupWindow) {
        let attempts = 0;

        const timer =
            setInterval(() => {
                attempts++;

                try {
                    if (
                        popupWindow.closed ||
                        attempts > 300
                    ) {
                        clearInterval(timer);
                        return;
                    }

                    const popupDocument =
                        popupWindow.document;

                    if (
                        popupDocument &&
                        popupDocument.documentElement
                    ) {
                        attachDocument(
                            popupDocument,
                            'плавающее окно'
                        );

                        clearInterval(timer);
                    }
                } catch (error) {
                    // Окно ещё загружается
                }
            }, 100);
    }


    function patchWindowOpen() {
        const pageWindow =
            typeof unsafeWindow !== 'undefined'
                ? unsafeWindow
                : window;

        if (
            pageWindow.__ktalkFilterOpenPatched
        ) {
            return;
        }

        const originalOpen =
            pageWindow.open;

        pageWindow.open =
            function (...args) {
                const popup =
                    originalOpen.apply(
                        this,
                        args
                    );

                if (popup) {
                    watchPopup(popup);
                }

                return popup;
            };

        pageWindow.__ktalkFilterOpenPatched =
            true;

        console.log(
            '[Фильтр] Перехват плавающих окон включён'
        );
    }


    loadForbiddenWords();

    setInterval(
        loadForbiddenWords,
        REFRESH_INTERVAL
    );

    attachDocument(
        document,
        'основное окно'
    );

    patchWindowOpen();
})();
