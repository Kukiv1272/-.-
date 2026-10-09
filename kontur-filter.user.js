// ==UserScript==
// @name         Фильтр запрещённых слов для Контур.Толка
// @namespace    https://example.local/
// @version      2.5
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

    const WORDS_API_URL =
        'https://script.google.com/macros/s/AKfycbxiJq8rcHC6gotGHqqix-LY1DfR50S1zzuRGUb3vS0V_ksMMC78aqjbExjq5aJSLHBwrg/exec?key=sdkjlfbbndmbhki;ddmjhhkmsdfgokapdfjkkggdjfgiad;fg2395klsdfgdfgmjdjf';

    const REFRESH_INTERVAL = 5 * 60 * 1000;

    const MESSAGE_FIELD_SELECTOR =
        'textarea.area[placeholder="Отправить сообщение"]';

    const SEND_BUTTON_SELECTOR =
        'button[type="submit"][aria-label="Отправить"]';

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


    function chooseField(fields) {
        const visibleFields =
            fields.filter(isVisible);

        if (!visibleFields.length) {
            return null;
        }

        // Сначала выбираем активное поле
        const activeField =
            visibleFields.find(
                field => field === document.activeElement
            );

        if (activeField) {
            return activeField;
        }

        // Затем поле, в котором уже есть текст
        const filledField =
            visibleFields.find(
                field => String(field.value || '').trim()
            );

        if (filledField) {
            return filledField;
        }

        // Иначе берём первое видимое поле
        return visibleFields[0];
    }


    function findMessageField(source) {
        if (
            source instanceof Element &&
            source.matches(MESSAGE_FIELD_SELECTOR)
        ) {
            return source;
        }

        if (source instanceof Element) {
            // Поле в плавающем или обычном окне чата
            const textBlock =
                source.closest('.text');

            if (textBlock) {
                const field =
                    chooseField([
                        ...textBlock.querySelectorAll(
                            MESSAGE_FIELD_SELECTOR
                        )
                    ]);

                if (field) {
                    return field;
                }
            }

            const chatArea =
                source.closest('.chat-message-area');

            if (chatArea) {
                const field =
                    chooseField([
                        ...chatArea.querySelectorAll(
                            MESSAGE_FIELD_SELECTOR
                        )
                    ]);

                if (field) {
                    return field;
                }
            }

            const form =
                source.closest('form');

            if (form) {
                const field =
                    chooseField([
                        ...form.querySelectorAll(
                            MESSAGE_FIELD_SELECTOR
                        )
                    ]);

                if (field) {
                    return field;
                }
            }
        }

        // Проверяем активное поле
        if (
            document.activeElement instanceof Element &&
            document.activeElement.matches(
                MESSAGE_FIELD_SELECTOR
            ) &&
            isVisible(document.activeElement)
        ) {
            return document.activeElement;
        }

        // Последний вариант — любое видимое поле
        return chooseField([
            ...document.querySelectorAll(
                MESSAGE_FIELD_SELECTOR
            )
        ]);
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
                } catch (error) {
                    console.error(
                        '[Фильтр] Ошибка списка слов:',
                        error
                    );

                    if (!wordsLoaded) {
                        wordsLoadError = true;
                    }
                }
            },

            onerror(error) {
                console.error(
                    '[Фильтр] Ошибка загрузки:',
                    error
                );

                if (!wordsLoaded) {
                    wordsLoadError = true;
                }
            }
        });
    }


    function findForbiddenWord(text) {
        const message =
            normalizeText(text);

        for (const word of forbiddenWords) {
            const escapedWord =
                escapeRegExp(word);

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


    function showWarning(message) {
        if (!document.body) {
            return;
        }

        warningElement?.remove();
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
            boxShadow: '0 4px 15px rgba(0,0,0,.3)'
        });

        document.body.appendChild(warningElement);

        warningTimer =
            setTimeout(() => {
                warningElement?.remove();
                warningElement = null;
            }, 4500);
    }


    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }


    function checkMessage(event, source) {
        const field =
            findMessageField(source);

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


    // Кнопка отправки в плавающем и обычном окне
    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) {
            return;
        }

        const button =
            event.target.closest(
                SEND_BUTTON_SELECTOR
            );

        if (button) {
            checkMessage(event, button);
        }
    }, true);


    // Enter в любом видимом поле сообщения
    document.addEventListener('keydown', event => {
        if (
            event.key !== 'Enter' ||
            event.shiftKey ||
            !(event.target instanceof Element)
        ) {
            return;
        }

        if (
            event.target.matches(
                MESSAGE_FIELD_SELECTOR
            )
        ) {
            checkMessage(event, event.target);
        }
    }, true);


    // Дополнительная проверка отправки формы
    document.addEventListener('submit', event => {
        if (event.target instanceof Element) {
            checkMessage(event, event.target);
        }
    }, true);


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
})();
