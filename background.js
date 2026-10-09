const WORDS_API_URL =
    'https://script.google.com/macros/s/AKfycbxiJq8rcHC6gotGHqqix-LY1DfR50S1zzuRGUb3vS0V_ksMMC78aqjbExjq5aJSLHBwrg/exec?key=sdkjlfbbndmbhki;ddmjhhkmsdfgokapdfjkkggdjfgiad;fg2395klsdfgdfgmjdjf';

const GITHUB_RELEASES_API =
    'https://api.github.com/repos/Kukiv1272/kontur-filter/releases/latest';
const GITHUB_RELEASES_PAGE =
    'https://github.com/Kukiv1272/kontur-filter/releases';
const UPDATE_ALARM_NAME = 'kontur-filter-update-check';
const UPDATE_CHECK_PERIOD_MINUTES = 360;

let cachedWords = [];
let loadedAt = 0;
let loadingPromise = null;
let storageHydrated = false;

const CACHE_TTL = 30000;

let latestReleaseUrl = GITHUB_RELEASES_PAGE;

function versionParts(version) {
    const numbers = String(version || '')
        .trim()
        .replace(/^v/i, '')
        .match(/\d+(?:\.\d+)*/);

    return numbers
        ? numbers[0].split('.').map(Number)
        : [0];
}

function isVersionNewer(latest, current) {
    const latestParts = versionParts(latest);
    const currentParts = versionParts(current);
    const length = Math.max(latestParts.length, currentParts.length);

    for (let index = 0; index < length; index += 1) {
        const latestNumber = latestParts[index] || 0;
        const currentNumber = currentParts[index] || 0;

        if (latestNumber > currentNumber) {
            return true;
        }

        if (latestNumber < currentNumber) {
            return false;
        }
    }

    return false;
}

async function checkForUpdate() {
    try {
        const response = await fetch(GITHUB_RELEASES_API, {
            cache: 'no-store',
            headers: {
                Accept: 'application/vnd.github+json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const release = await response.json();
        const currentVersion = chrome.runtime.getManifest().version;
        const latestVersion = release.tag_name || release.name || '';

        latestReleaseUrl = release.html_url || GITHUB_RELEASES_PAGE;

        if (isVersionNewer(latestVersion, currentVersion)) {
            chrome.action.setBadgeText({ text: 'NEW' });
            chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
            chrome.action.setTitle({
                title: `Доступно обновление: ${latestVersion}`
            });

            await chrome.storage.local.set({
                latestReleaseVersion: latestVersion,
                latestReleaseUrl
            });

            console.log(
                `[Контур-фильтр] Доступно обновление ${latestVersion}.`,
                latestReleaseUrl
            );
        } else {
            chrome.action.setBadgeText({ text: '' });
            chrome.action.setTitle({
                title: `Фильтр запрещённых слов — версия ${currentVersion}`
            });

            await chrome.storage.local.set({
                latestReleaseVersion: latestVersion,
                latestReleaseUrl
            });

            console.log(
                `[Контур-фильтр] Установлена актуальная версия ${currentVersion}.`
            );
        }
    } catch (error) {
        console.warn(
            '[Контур-фильтр] Не удалось проверить обновления GitHub:',
            error
        );
    }
}

function normalizeText(text) {
    return String(text || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('ru-RU');
}

function parseWords(items) {
    return [
        ...new Set(
            items
                .flatMap(item => String(item).split(/[\s,;]+/))
                .map(normalizeText)
                .filter(Boolean)
        )
    ];
}

async function loadWords(force = false) {
    if (!storageHydrated) {
        const stored = await chrome.storage.local.get([
            'cachedWords',
            'loadedAt'
        ]);

        if (Array.isArray(stored.cachedWords)) {
            cachedWords = stored.cachedWords;
        }

        if (Number.isFinite(stored.loadedAt)) {
            loadedAt = stored.loadedAt;
        }

        storageHydrated = true;
    }

    const cacheAge = Date.now() - loadedAt;

    if (!force && loadedAt && cacheAge < CACHE_TTL) {
        return cachedWords;
    }

    if (loadingPromise) {
        return loadingPromise;
    }

    loadingPromise = (async () => {
        const separator = WORDS_API_URL.includes('?') ? '&' : '?';
        const response = await fetch(
            WORDS_API_URL + separator + '_=' + Date.now(),
            { cache: 'no-store' }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (!Array.isArray(data.words)) {
            throw new Error('В ответе нет массива words');
        }

        cachedWords = parseWords(data.words);
        loadedAt = Date.now();

        await chrome.storage.local.set({
            cachedWords,
            loadedAt
        });

        console.log('[Контур-фильтр] Загружено слов:', cachedWords.length);
        console.log('[Контур-фильтр] Слово 1:', cachedWords.includes('1'));

        return cachedWords;
    })();

    try {
        return await loadingPromise;
    } catch (error) {
        if (cachedWords.length) {
            console.warn(
                '[Контур-фильтр] Используется сохранённый список:',
                error
            );

            return cachedWords;
        }

        throw error;
    } finally {
        loadingPromise = null;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'getWords') {
        return;
    }

    loadWords(Boolean(message.force))
        .then(words => sendResponse({ ok: true, words }))
        .catch(error => {
            console.error('[Контур-фильтр] Ошибка базы:', error);
            sendResponse({ ok: false, error: String(error.message || error) });
        });

    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    loadWords(true).catch(error => {
        console.warn('[Контур-фильтр] Первый запуск:', error);
    });

    chrome.alarms.create(UPDATE_ALARM_NAME, {
        periodInMinutes: UPDATE_CHECK_PERIOD_MINUTES
    });

    checkForUpdate();
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(UPDATE_ALARM_NAME, {
        periodInMinutes: UPDATE_CHECK_PERIOD_MINUTES
    });

    checkForUpdate();
});

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === UPDATE_ALARM_NAME) {
        checkForUpdate();
    }
});

chrome.action.onClicked.addListener(async () => {
    const stored = await chrome.storage.local.get('latestReleaseUrl');
    const url = stored.latestReleaseUrl || latestReleaseUrl;

    chrome.tabs.create({ url });
});

checkForUpdate();
