// ==UserScript==
// @name         Фильтр запрещённых слов для Контур.Толка
// @namespace    https://example.local/
// @version      2.3
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

    // Находит оба варианта поля сообщения
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


    // Разделяет список из Google на отдельные слова:
    // "слово1 слово2,слово3;слово4"
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


    function getFieldFromElement(element) {
        if (!(element instanceof Element)) {
            return null;
        }

        if (element.matches(MESSAGE_FIELD_SELECTOR)) {
            return element;
        }

        // Кнопка и textarea находятся внутри одного блока .text
        const textBlock = element.closest('.text');

        if (textBlock) {
            const field = textBlock.querySelector(
                MESSAGE_FIELD_SELECTOR
            );

            if (field) {
                return field;
            }
        }

        // Дополнительный вариант для формы
        const form = element.closest('form');

        if (form) {
            const field = form.querySelector(
                MESSAGE_FIELD_SELECTOR
            );

            if (field) {
                return field;
            }
        }

        // Вариант для chat-message-area
        const chatArea = element.closest('chat-message-area');

        if (chatArea) {
            const field = chatArea.querySelector(
                MESSAGE_FIELD_SELECTOR
            );

            if (field) {
                return field;
            }
        }

        return null;
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

                    // Важная часть: разделение слов по пробелам,
                    // запятым и точкам с запятой
                    forbiddenWords =
                        parseWords(data.words);

                    wordsLoaded = true;
                    wordsLoadError = false;

                    console.log(
                        '[Фильтр слов] Загружено:',
                        forbiddenWords.length,
                        forbiddenWords
                    );
                } catch (error) {
                    console.error(
                        '[Фильтр слов] Ошибка обработки списка:',
                        error
                    );

                    if (!wordsLoaded) {
                        wordsLoadError = true;
                    }
                }
            },

            onerror(error) {
                console.error(
                    '[Фильтр слов] Ошибка загрузки:',
                    error
                );

                if (!wordsLoaded) {
                    wordsLoadError = true;
                }
            }
        });
    }


    function findForbiddenWord(text) {
        const normalizedText =
            normalizeText(text);

        for (const word of forbiddenWords) {
            const escapedWord =
                escapeRegExp(word)
                    .replace(/\s+/g, '\\s+');

            const regexp = new RegExp(
                `(^|[^\\p{L}\\p{N}_])` +
                escapedWord +
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
            boxShadow: '0 4px 15px rgba(0,0,0,.3)'
        });

        if (document.body) {
            document.body.appendChild(warningElement);
        }

        warningTimer =
            setTimeout(() => {
                warningElement?.remove();
                warningElement = null;
            }, 4500);
    }


    function blockSending(event, source) {
        const field =
            getFieldFromElement(source);

        if (!field) {
            return;
        }

        if (!wordsLoaded) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

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

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        showWarning(
            `Сообщение не отправлено. ` +
            `Найдено запрещённое слово: «${forbiddenWord}»`
        );

        field.focus();
    }


    // Нажатие кнопки «Отправить»
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


    // Отправка клавишей Enter
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
            blockSending(event, event.target);
        }
    }, true);


    // Отправка через форму
    document.addEventListener('submit', event => {
        if (event.target instanceof Element) {
            blockSending(event, event.target);
        }
    }, true);


    // Загружаем список сразу
    loadForbiddenWords();

    // Обновляем список каждые 5 минут
    setInterval(
        loadForbiddenWords,
        REFRESH_INTERVAL
    );

    // Обновляем список при возвращении на вкладку
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
