// ==UserScript==
// @name         Фильтр запрещённых слов для Контур.Толка
// @namespace    https://example.local/
// @version      2.2
// @description  Загружает запрещённые слова из Google Таблицы
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

    // Подходит для обоих вариантов поля из присланного HTML
    const MESSAGE_FIELD_SELECTOR =
        'textarea.area[placeholder="Отправить сообщение"]';

    const SEND_BUTTON_SELECTOR =
        'button[type="submit"][aria-label="Отправить"]';

    let forbiddenWords = [];
    let wordsLoaded = false;
    let wordsLoadError = false;
    let lastRequestAt = 0;

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


    function getMessageFields(source) {
        if (!(source instanceof Element)) {
            return [];
        }

        if (source.matches(MESSAGE_FIELD_SELECTOR)) {
            return [source];
        }

        // Поле и кнопка отправки находятся в одном .text
        const composer = source.closest('.text');

        if (composer) {
            const fields = Array.from(
                composer.querySelectorAll(MESSAGE_FIELD_SELECTOR)
            );

            if (fields.length) {
                return fields;
            }
        }

        // Запасной вариант для отправки через форму
        const form = source.closest('form');

        if (form) {
            const fields = Array.from(
                form.querySelectorAll(MESSAGE_FIELD_SELECTOR)
            );

            if (fields.length) {
                return fields;
            }
        }

        // Запасной вариант для контейнера чата
        const chatArea = source.closest('chat-message-area');

        if (chatArea) {
            const fields = Array.from(
                chatArea.querySelectorAll(MESSAGE_FIELD_SELECTOR)
            );

            if (fields.length) {
                return fields;
            }
        }

        return [];
    }


    function loadForbiddenWords(force = false) {
        const now = Date.now();

        // Не делаем повторные запросы при одновременных focus/visibility событиях
        if (!force && now - lastRequestAt < 10000) {
            return;
        }

        lastRequestAt = now;

        const separator =
            WORDS_API_URL.includes('?') ? '&' : '?';

        GM_xmlhttpRequest({
            method: 'GET',
            url: WORDS_API_URL + separator + '_=' + now,

            onload(response) {
                try {
                    const data = JSON.parse(response.responseText);

                    if (data.error) {
                        throw new Error(data.error);
                    }

                    if (!Array.isArray(data.words)) {
                        throw new Error(
                            'В ответе Google нет массива words'
                        );
                    }

                    forbiddenWords = [
                        ...new Set(
                            data.words
                                .map(normalizeText)
                                .filter(Boolean)
                        )
                    ];

                    wordsLoaded = true;
                    wordsLoadError = false;

                    console.log(
                        '[Фильтр слов] Загружено:',
                        forbiddenWords.length
                    );
                } catch (error) {
                    console.error(
                        '[Фильтр слов] Ошибка ответа:',
                        error
                    );

                    // Если раньше список уже загрузился, продолжаем
                    // использовать последнюю успешно полученную версию.
                    if (!wordsLoaded) {
                        wordsLoaded = true;
                        wordsLoadError = true;
                    }
                }
            },

            onerror(error) {
                console.error(
                    '[Фильтр слов] Ошибка запроса:',
                    error
                );

                // При сбое обновления сохраняем предыдущий список.
                if (!wordsLoaded) {
                    wordsLoaded = true;
                    wordsLoadError = true;
                }
            }
        });
    }


    function findForbiddenWord(text) {
        const normalizedText = normalizeText(text);

        for (const word of forbiddenWords) {
            const escapedWord =
                escapeRegExp(word).replace(/\s+/g, '\\s+');

            const regexp = new RegExp(
                `(^|[^\\p{L}\\p{N}_])${escapedWord}` +
                `($|[^\\p{L}\\p{N}_])`,
                'iu'
            );

            if (regexp.test(normalizedText)) {
                return word;
            }
        }

        return null;
    }


    function showWarning(message) {
        if (!document.body) {
            document.addEventListener(
                'DOMContentLoaded',
                () => showWarning(message),
                { once: true }
            );
            return;
        }

        if (warningElement) {
            warningElement.remove();
        }

        clearTimeout(warningTimer);

        warningElement = document.createElement('div');
        warningElement.textContent = message;

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

        warningTimer = setTimeout(() => {
            warningElement?.remove();
            warningElement = null;
        }, 4500);
    }


    function blockSending(event, source) {
        let fields;

        if (Array.isArray(source)) {
            fields = source;
        } else {
            fields = getMessageFields(source);
        }

        if (!fields.length) {
            return;
        }

        if (!wordsLoaded) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            showWarning(
                'Список запрещённых слов ещё загружается.'
            );
            return;
        }

        if (wordsLoadError) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            showWarning(
                'Не удалось загрузить список запрещённых слов.'
            );
            return;
        }

        for (const field of fields) {
            const forbiddenWord =
                findForbiddenWord(field.value);

            if (!forbiddenWord) {
                continue;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            showWarning(
                `Сообщение не отправлено. ` +
                `Найдено запрещённое слово: «${forbiddenWord}»`
            );

            field.focus();
            return;
        }
    }


    // Нажатие кнопки отправки
    document.addEventListener('click', event => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const sendButton =
            target.closest(SEND_BUTTON_SELECTOR);

        if (sendButton) {
            blockSending(event, sendButton);
        }
    }, true);


    // Enter отправляет сообщение; Shift+Enter оставляет перенос строки
    document.addEventListener('keydown', event => {
        if (
            event.key !== 'Enter' ||
            event.shiftKey ||
            !(event.target instanceof Element) ||
            !event.target.matches(MESSAGE_FIELD_SELECTOR)
        ) {
            return;
        }

        blockSending(event, event.target);
    }, true);


    // Отправка формы
    document.addEventListener('submit', event => {
        const fields = [];

        if (event.submitter instanceof Element) {
            fields.push(...getMessageFields(event.submitter));
        }

        if (event.target instanceof Element) {
            fields.push(...getMessageFields(event.target));
        }

        const uniqueFields = [...new Set(fields)];

        if (uniqueFields.length) {
            blockSending(event, uniqueFields);
        }
    }, true);


    // Загружаем список при запуске, затем обновляем его периодически
    loadForbiddenWords(true);

    setInterval(
        () => loadForbiddenWords(true),
        REFRESH_INTERVAL
    );

    // Обновляем список при возвращении на вкладку
    window.addEventListener('focus', () => loadForbiddenWords());

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            loadForbiddenWords();
        }
    });
})();
