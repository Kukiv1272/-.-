// ==UserScript==
// @name         Фильтр запрещённых слов для Контур.Толка
// @namespace    https://example.local/
// @version      2.1
// @downloadURL  https://raw.githubusercontent.com/Kukiv1272/-.-/refs/heads/main/kontur-filter.user.js
// @updateURL    https://raw.githubusercontent.com/Kukiv1272/-.-/refs/heads/main/kontur-filter.user.js
// @description  Загружает запрещённые слова из Google Таблицы
// @match        https://talk.kontur.ru/*
// @match        https://*.talk.kontur.ru/*
// @match        https://*.ktalk.ru/*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    // =========================================
    // ВСТАВЬ СЮДА URL ИЗ GOOGLE APPS SCRIPT
    // =========================================

    const WORDS_API_URL =
        'https://script.google.com/macros/s/AKfycbxiJq8rcHC6gotGHqqix-LY1DfR50S1zzuRGUb3vS0V_ksMMC78aqjbExjq5aJSLHBwrg/exec?key=sdkjlfbbndmbhki;ddmjhhkmsdfgokapdfjkkggdjfgiad;fg2395klsdfgdfgmjdjf';

    // Обновление списка каждые 5 минут
    const REFRESH_INTERVAL =
        5 * 60 * 1000;

    // Точные селекторы Контур.Толка
    const MESSAGE_FIELD_SELECTOR =
        'chat-message-area textarea.area[placeholder="Отправить сообщение"]';

    const SEND_BUTTON_SELECTOR =
        'chat-message-area button[type="submit"][aria-label="Отправить"]';

    let forbiddenWords = [];
    let wordsLoaded = false;
    let wordsLoadError = false;

    let warningElement = null;
    let warningTimer = null;


    function normalizeText(text) {
        return String(text || '')
            .normalize('NFKC')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase('ru-RU');
    }


    function escapeRegExp(text) {
        return text.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );
    }


    function loadForbiddenWords() {
        const cacheParameter =
            WORDS_API_URL.includes('?') ? '&' : '?';

        GM_xmlhttpRequest({
            method: 'GET',

            url:
                WORDS_API_URL +
                cacheParameter +
                '_=' +
                Date.now(),

            onload(response) {
                try {
                    const data =
                        JSON.parse(response.responseText);

                    if (!Array.isArray(data.words)) {
                        throw new Error(
                            'Google Apps Script вернул ошибку'
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
                        'Загружено запрещённых слов:',
                        forbiddenWords.length
                    );
                } catch (error) {
                    wordsLoaded = true;
                    wordsLoadError = true;

                    console.error(
                        'Ошибка обработки списка слов:',
                        error
                    );
                }
            },

            onerror() {
                wordsLoaded = true;
                wordsLoadError = true;

                console.error(
                    'Не удалось загрузить список из Google Таблицы'
                );
            }
        });
    }


    function findForbiddenWord(text) {
        const normalizedText =
            normalizeText(text);

        for (const word of forbiddenWords) {
            const escapedWord =
                escapeRegExp(word)
                    .replace(/ /g, '\\s+');

            const regexp = new RegExp(
                `(^|[^\\p{L}\\p{N}_])` +
                `${escapedWord}` +
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

        if (document.body) {
            document.body.appendChild(warningElement);
        }

        warningTimer = setTimeout(() => {
            if (warningElement) {
                warningElement.remove();
                warningElement = null;
            }
        }, 4500);
    }


    function blockSending(event) {
        // Не разрешаем отправку, пока список не загрузился
        if (!wordsLoaded) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            showWarning(
                'Список запрещённых слов ещё загружается.'
            );

            return;
        }

        // Если список не загрузился, блокируем отправку
        if (wordsLoadError) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            showWarning(
                'Не удалось загрузить список запрещённых слов.'
            );

            return;
        }

        const field =
            document.querySelector(
                MESSAGE_FIELD_SELECTOR
            );

        if (!field) {
            return;
        }

        const message = field.value || '';

        const forbiddenWord =
            findForbiddenWord(message);

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


    // Блокировка клика по кнопке «Отправить»
    document.addEventListener('click', event => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const sendButton =
            target.closest(SEND_BUTTON_SELECTOR);

        if (sendButton) {
            blockSending(event);
        }
    }, true);


    // Блокировка Enter в поле сообщения
    document.addEventListener('keydown', event => {
        if (event.key !== 'Enter') {
            return;
        }

        // Shift + Enter оставляет перенос строки
        if (event.shiftKey) {
            return;
        }

        const target = event.target;

        if (
            target instanceof Element &&
            target.matches(MESSAGE_FIELD_SELECTOR)
        ) {
            blockSending(event);
        }
    }, true);


    // Дополнительная блокировка отправки формы
    document.addEventListener('submit', event => {
        const form = event.target;

        if (
            form &&
            form.querySelector &&
            form.querySelector(MESSAGE_FIELD_SELECTOR)
        ) {
            blockSending(event);
        }
    }, true);


    // Загружаем список сразу
    loadForbiddenWords();

    // Периодически обновляем список
    setInterval(
        loadForbiddenWords,
        REFRESH_INTERVAL
    );
})();
