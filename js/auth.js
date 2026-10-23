// 偏航 Web App · 账号与个人中心
// 游客优先：不登录也能完整使用；登录只负责保存资料，并为后续同步足迹与收藏做准备。

(function () {
    'use strict';

    var API_BASE = (typeof window.__API_BASE__ === 'string' ? window.__API_BASE__ : 'http://localhost:8001')
        .replace(/\/+$/, '');

    var state = {
        user: null,
        stats: null,
        detours: [],
        favorites: [],
        mode: 'login',
        lastFocus: null
    };

    function $(id) {
        return document.getElementById(id);
    }

    // ===== DOM =====
    var authModal = $('auth-modal');
    var authForm = $('auth-form');
    var authTitle = $('auth-title');
    var authSub = $('auth-sub');
    var authTabs = Array.prototype.slice.call(document.querySelectorAll('[data-auth-mode]'));
    var authUsername = $('auth-username');
    var authNickname = $('auth-nickname');
    var authNicknameField = $('auth-nickname-field');
    var authPassword = $('auth-password');
    var authError = $('auth-error');
    var authSubmit = $('auth-submit');
    var authClose = $('auth-close');
    var authDemoBox = $('auth-demo-box');
    var authDemo = $('auth-demo');

    var editModal = $('edit-modal');
    var editForm = $('edit-form');
    var editClose = $('edit-close');
    var editNickname = $('edit-nickname');
    var editCity = $('edit-city');
    var editBio = $('edit-bio');
    var editError = $('edit-error');
    var editSubmit = $('edit-submit');

    var profileLoginBtn = $('profile-login-btn');
    var profileEditBtn = $('profile-edit-btn');
    var profileLogoutBtn = $('profile-logout-btn');
    var profileAvatar = $('profile-avatar');
    var profileName = $('profile-display-name');
    var profileSub = $('profile-display-sub');
    var profileStats = $('profile-stats');
    var profileDetail = $('profile-detail');
    var profileBio = $('profile-bio');
    var profileCity = $('profile-city');
    var profileGuestNote = $('profile-guest-note');

    var sidebarName = document.querySelector('.profile-name');
    var sidebarSub = $('sidebar-sub');
    var profileCard = $('profile-card');

    var profilePrefsBody = $('profile-prefs-body');
    var profilePrefsNote = $('profile-prefs-note');

    var settingMode = $('setting-mode');
    var settingPace = $('setting-pace');
    var settingInterests = $('setting-interests');
    var settingState = $('setting-state');
    var settingError = $('setting-error');
    var settingSaveBtn = $('setting-save-btn');
    var settingResetBtn = $('setting-reset-btn');
    var settingSync = $('setting-sync');
    var settingSyncText = $('setting-sync-text');
    var settingLoginBtn = $('setting-login-btn');

    // ===== 请求 =====
    async function request(path, options) {
        options = options || {};
        var headers = options.headers || {};
        if (options.body) headers['Content-Type'] = 'application/json';

        var res;
        try {
            res = await fetch(API_BASE + path, {
                method: options.method || 'GET',
                headers: headers,
                body: options.body,
                credentials: 'include',
                cache: 'no-store'
            });
        } catch (e) {
            throw new Error('连不上服务器，请确认后端已启动');
        }

        var data = null;
        try {
            data = await res.json();
        } catch (e) { /* 空响应或非 JSON */ }

        if (!res.ok) {
            var err = new Error(errorText(data) || ('请求失败（' + res.status + '）'));
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function errorText(data) {
        if (!data) return '';
        if (typeof data.detail === 'string') return data.detail;
        if (Array.isArray(data.detail)) {
            return data.detail.map(function (item) {
                return item.msg || '输入有误';
            }).join('；');
        }
        return '';
    }


    // ===== 偏航记录 / 足迹 / 成就 =====
    var MODE_LABELS = { walk: '步行', bike: '骑行 · 自行车', ebike: '骑行 · 电动车' };
    var BADGE_HINTS = {
        first: '完成 1 次偏航',
        coffee: '完成 3 次偏航',
        rain: '在雨或雪的天气出发',
        alleys: '累计到访 5 个不同地点',
        night: '在 19:00 后或 05:00 前出发',
        city: '累计偏航 20 km'
    };

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    // ===== 偏好设置（游客存本机，登录后同步账号） =====
    var PREF_PACE_LABELS = { slow: '慢慢逛', steady: '适中', far: '走远一点' };
    var PREF_DEFAULT = { default_mode: 'walk', pace: 'steady', interests: [] };
    var settingsDraft = null;
    var settingsDirty = false;
    var settingsSaving = false;
    var settingsNotice = '';

    function prefsModule() {
        return window.PianhangPrefs || null;
    }

    function clonePrefs(prefs) {
        return {
            default_mode: prefs.default_mode,
            pace: prefs.pace,
            interests: (prefs.interests || []).slice()
        };
    }

    function normalizePrefs(prefs) {
        var module = prefsModule();
        if (module) return module.normalize(prefs);
        return clonePrefs(PREF_DEFAULT);
    }

    function localPrefs() {
        var module = prefsModule();
        return module ? module.get() : clonePrefs(PREF_DEFAULT);
    }

    function currentPrefs() {
        if (state.user && state.user.preferences) {
            return normalizePrefs(state.user.preferences);
        }
        return localPrefs();
    }

    function persistLocalPrefs(prefs) {
        var module = prefsModule();
        if (module) module.set(prefs);
    }

    function setActiveButtons(container, attr, value) {
        if (!container) return;
        Array.prototype.forEach.call(container.querySelectorAll('button'), function (btn) {
            btn.classList.toggle('active', btn.getAttribute(attr) === value);
        });
    }

    function syncSettingControls() {
        if (!settingsDraft) return;
        setActiveButtons(settingMode, 'data-mode', settingsDraft.default_mode);
        setActiveButtons(settingPace, 'data-pace', settingsDraft.pace);
        if (settingInterests) {
            Array.prototype.forEach.call(settingInterests.querySelectorAll('button'), function (btn) {
                btn.classList.toggle('active',
                    settingsDraft.interests.indexOf(btn.getAttribute('data-interest')) >= 0);
            });
        }
    }

    function updateSettingStatus() {
        if (!settingState) return;
        if (settingsSaving) {
            settingState.textContent = '正在保存…';
        } else if (settingsDirty) {
            settingState.textContent = '有未保存的修改';
        } else if (settingsNotice) {
            settingState.textContent = settingsNotice;
        } else if (state.user) {
            settingState.textContent = '已同步到账号 @' + state.user.username + '，下次生成路线时生效。';
        } else {
            settingState.textContent = '偏好保存在这台设备上，登录后会同步到账号。';
        }
        if (settingSaveBtn) {
            settingSaveBtn.disabled = settingsSaving;
            settingSaveBtn.textContent = settingsSaving ? '保存中…' : '保存偏好';
        }
        if (settingResetBtn) settingResetBtn.disabled = settingsSaving;
        if (settingSync) settingSync.hidden = !!state.user;
    }

    function renderSettings(force) {
        if (!settingMode) return;
        if (force || !settingsDraft || !settingsDirty) {
            settingsDraft = clonePrefs(currentPrefs());
        }
        syncSettingControls();
        hideError(settingError);
        updateSettingStatus();
    }

    function markSettingsDirty() {
        settingsDirty = true;
        settingsNotice = '';
        hideError(settingError);
        syncSettingControls();
        updateSettingStatus();
    }

    function readSettingsDraft() {
        if (!settingsDraft) return clonePrefs(PREF_DEFAULT);
        return normalizePrefs(settingsDraft);
    }

    function renderProfilePrefs() {
        if (!profilePrefsBody) return;
        var prefs = currentPrefs();
        var chips = [
            '<span class="profile-pref-chip">默认 ' + esc(MODE_LABELS[prefs.default_mode] || '步行') + '</span>',
            '<span class="profile-pref-chip">节奏 ' + esc(PREF_PACE_LABELS[prefs.pace] || '适中') + '</span>'
        ];
        if (prefs.interests.length) {
            prefs.interests.forEach(function (item) {
                chips.push('<span class="profile-pref-chip is-interest">' + esc(item) + '</span>');
            });
        } else {
            chips.push('<span class="profile-pref-chip">兴趣未选择</span>');
        }
        profilePrefsBody.innerHTML = chips.join('');
        if (profilePrefsNote) {
            profilePrefsNote.textContent = state.user
                ? '已同步到账号，下一次生成路线时会按这套偏好预选。'
                : '保存在这台设备上；登录后会跟着账号走。';
        }
    }

    async function savePreferencesToServer(prefs) {
        var data = await request('/api/auth/preferences', {
            method: 'PUT',
            body: JSON.stringify(normalizePrefs(prefs))
        });
        if (state.user) {
            state.user.preferences = data.preferences || normalizePrefs(prefs);
            state.user.preferences_set = true;
        }
        return normalizePrefs(data.preferences || prefs);
    }

    async function saveSettings() {
        if (!settingsDraft || settingsSaving) return;
        settingsSaving = true;
        hideError(settingError);
        updateSettingStatus();
        var prefs = readSettingsDraft();
        try {
            if (state.user) {
                prefs = await savePreferencesToServer(prefs);
            }
            persistLocalPrefs(prefs);
            settingsDraft = clonePrefs(prefs);
            settingsDirty = false;
            settingsNotice = state.user
                ? '已保存到账号，下次生成路线时生效。'
                : '已保存到这台设备，下次生成路线时生效。';
            renderProfilePrefs();
        } catch (err) {
            if (err.status === 401) {
                // 会话过期时先保住本机设置，再提示重新登录
                persistLocalPrefs(prefs);
                state.user = null;
                state.stats = null;
                settingsNotice = '登录已过期，偏好已先保存在本机。';
                settingsDirty = false;
                render();
                showError(settingError, '重新登录后可同步到账号。');
            } else {
                showError(settingError, '保存失败：' + err.message);
            }
        } finally {
            settingsSaving = false;
            syncSettingControls();
            updateSettingStatus();
        }
    }

    // 登录 / 注册成功后，把账号偏好带到本机；新账号会继承注册前在本机设置的偏好
    async function adoptPreferencesAfterAuth(user, wasLogin, guestPrefs, guestCustom) {
        var serverPrefs = normalizePrefs(user.preferences);
        if (!wasLogin && !user.preferences_set && guestCustom) {
            try {
                serverPrefs = await savePreferencesToServer(guestPrefs);
            } catch (err) {
                console.warn('注册后同步本机偏好失败: ' + err.message);
                serverPrefs = normalizePrefs(guestPrefs);
                persistLocalPrefs(serverPrefs);
                settingsDraft = null;
                if (settingsDirty) settingsDirty = false;
                renderSettings(true);
                renderProfilePrefs();
                return;
            }
        }
        persistLocalPrefs(serverPrefs);
        settingsDirty = false;
        settingsNotice = '';
        settingsDraft = null;
        renderSettings(true);
        renderProfilePrefs();
    }

    function fmtDetourTime(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
            String(date.getHours()).padStart(2, '0') + ':' +
            String(date.getMinutes()).padStart(2, '0');
    }

    function routeChain(d) {
        var names = [d.start_name || '当前位置'];
        (d.waypoints || []).forEach(function (w) {
            if (w && w.name) names.push(w.name);
        });
        if (d.end_name) names.push(d.end_name);
        return names.join(' → ');
    }

    function detourMeta(d) {
        var bits = [MODE_LABELS[d.mode] || '步行'];
        if (d.minutes) bits.push(d.minutes + ' 分钟');
        if ((d.waypoints || []).length) bits.push(d.waypoints.length + ' 站');
        if (d.weather) bits.push(d.weather);
        return bits.join(' · ');
    }

    function uniquePlaces(detours) {
        var seen = {}, n = 0;
        detours.forEach(function (d) {
            (d.waypoints || []).forEach(function (w) {
                if (w && w.name && !seen[w.name]) { seen[w.name] = 1; n++; }
            });
        });
        return n;
    }

    // 徽章以后端返回的真实统计为准；旧版后端没有 badge_keys 时按同一口径在本地兜底
    function localBadgeState(detours, stats) {
        var rain = false, night = false, places = {};
        detours.forEach(function (d) {
            if (/雨|雪/.test(d.weather || '')) rain = true;
            var date = new Date(d.created_at);
            if (!isNaN(date.getTime()) && (date.getHours() >= 19 || date.getHours() < 5)) night = true;
            (d.waypoints || []).forEach(function (w) {
                if (w && w.name) places[w.name] = 1;
            });
        });
        var count = detours.length;
        var km = Number(stats.distance_km || 0);
        var placeCount = Object.keys(places).length;
        var progress = {
            first: { current: Math.min(count, 1), target: 1, unit: '次' },
            coffee: { current: Math.min(count, 3), target: 3, unit: '次' },
            rain: { current: rain ? 1 : 0, target: 1, unit: '次' },
            alleys: { current: Math.min(placeCount, 5), target: 5, unit: '个地点' },
            night: { current: night ? 1 : 0, target: 1, unit: '次' },
            city: { current: km, target: 20, unit: 'km' }
        };
        var keys = Object.keys(progress).filter(function (key) {
            return progress[key].current >= progress[key].target;
        });
        return { keys: keys, progress: progress, count: keys.length };
    }

    function badgeState(detours, stats) {
        if (stats && Array.isArray(stats.badge_keys)) {
            return {
                keys: stats.badge_keys.slice(),
                progress: stats.badge_progress || {},
                count: typeof stats.badges === 'number' ? stats.badges : stats.badge_keys.length
            };
        }
        return localBadgeState(detours, stats || {});
    }

    function badgeProgressText(key, item) {
        if (!item || typeof item.current !== 'number' || !item.target) return '';
        if (key === 'rain') return item.current ? '已遇到雨天' : '等一场雨';
        if (key === 'night') return item.current ? '已经夜行' : '等一次夜行';
        if (key === 'city') return item.current + ' / ' + item.target + ' km';
        if (key === 'alleys') return item.current + ' / ' + item.target + ' 个地点';
        return item.current + ' / ' + item.target + ' 次';
    }

    function fmtMonthDay(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return (date.getMonth() + 1) + '月' + date.getDate() + '日';
    }

    function typeColor(type) {
        var colors = {
            '公园': '#22c55e', '咖啡店': '#d97706', '书店': '#3b82f6',
            '博物馆': '#a855f7', '广场': '#06b6d4', '景点': '#ef4444',
            '地标': '#eab308', '路口': '#64748b', '街道': '#94a3b8'
        };
        return colors[type] || '#f59e0b';
    }

    function validCoord(lat, lng) {
        return typeof lat === 'number' && typeof lng === 'number' &&
            isFinite(lat) && isFinite(lng) &&
            !(Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7);
    }

    function detourHasGeometry(d) {
        if (!d) return false;
        if (Array.isArray(d.path) && d.path.length > 1) return true;
        if (validCoord(d.start_lat, d.start_lng)) return true;
        return (d.waypoints || []).some(function (w) {
            return w && validCoord(w.lat, w.lng);
        });
    }

    // 足迹页：按地点去重，统计到访次数与最近到访时间，而不是再列一遍行程
    function collectFootprintPlaces(detours) {
        var places = {};
        detours.forEach(function (d) {
            (d.waypoints || []).forEach(function (w) {
                if (!w || !w.name) return;
                var key = w.name + '|' + (w.type || '');
                var item = places[key];
                if (!item) {
                    item = places[key] = {
                        name: w.name,
                        type: w.type || '地点',
                        visits: 0,
                        lastAt: d.created_at,
                        lastId: d.id
                    };
                }
                item.visits++;
            });
        });
        var list = Object.keys(places).map(function (key) { return places[key]; });
        // 偏航记录已按时间倒序，第一次出现即最近一次
        list.sort(function (a, b) {
            return (new Date(b.lastAt) - new Date(a.lastAt)) || (b.visits - a.visits);
        });

        var typeMap = {};
        list.forEach(function (item) {
            typeMap[item.type] = (typeMap[item.type] || 0) + 1;
        });
        var types = Object.keys(typeMap).map(function (type) {
            return { type: type, count: typeMap[type] };
        }).sort(function (a, b) {
            return (b.count - a.count) || a.type.localeCompare(b.type, 'zh');
        });
        return { list: list, types: types };
    }

    function renderFootprints(detours, visible) {
        var fpList = $('footprint-list');
        var fpEmpty = $('footprints-empty');
        if (fpList) fpList.hidden = !visible;
        if (fpEmpty) fpEmpty.hidden = visible;
        if (!fpList) return;
        if (!visible) {
            fpList.innerHTML = '';
            return;
        }

        var data = collectFootprintPlaces(detours);
        var total = data.list.length;
        var maxType = data.types.reduce(function (max, item) {
            return Math.max(max, item.count);
        }, 1);

        var typeRows = data.types.map(function (item) {
            var pct = Math.max(8, Math.round(item.count / maxType * 100));
            return '<div class="footprint-type-row">' +
                '<span class="footprint-type-label"><i style="--type-color:' + typeColor(item.type) + '"></i>' + esc(item.type) + '</span>' +
                '<span class="footprint-type-bar"><i style="width:' + pct + '%;--type-color:' + typeColor(item.type) + '"></i></span>' +
                '<span class="footprint-type-count">' + item.count + '</span>' +
                '</div>';
        }).join('');

        var cards = data.list.slice(0, 12).map(function (item) {
            return '<article class="footprint-place">' +
                '<div class="footprint-place-top">' +
                '<span class="footprint-place-type" style="--type-color:' + typeColor(item.type) + '">' + esc(item.type) + '</span>' +
                '<span class="footprint-place-visits">' + (item.visits > 1 ? ('到访 ' + item.visits + ' 次') : '到访 1 次') + '</span>' +
                '</div>' +
                '<strong class="footprint-place-name">' + esc(item.name) + '</strong>' +
                '<span class="footprint-place-last">最近 · ' + esc(fmtMonthDay(item.lastAt)) + '</span>' +
                '</article>';
        }).join('');

        fpList.innerHTML =
            '<div class="footprint-summary">' +
            '<div class="footprint-summary-head">' +
            '<h3>到访地点</h3>' +
            '<p>去重后的 ' + total + ' 个地方 · 按最近到访排序</p>' +
            '</div>' +
            '<div class="footprint-types">' + typeRows + '</div>' +
            '</div>' +
            '<div class="footprint-grid">' + cards + '</div>' +
            (total > 12 ? '<p class="footprint-more">还有 ' + (total - 12) + ' 个地点，继续偏航会慢慢补全。</p>' : '');
    }

    function renderDetourPages() {
        var detours = state.detours || [];
        var stats = state.stats || {};
        var logged = !!state.user;
        var visible = logged && detours.length > 0;

        var fpDistance = $('fp-distance');
        var fpCount = $('fp-count');
        var fpPlaces = $('fp-places');
        if (fpDistance) fpDistance.textContent = logged ? Number(stats.distance_km || 0).toFixed(2) : '0.00';
        if (fpCount) fpCount.textContent = logged ? String(stats.detours || 0) : '0';
        if (fpPlaces) fpPlaces.textContent = logged
            ? String(stats.places != null ? stats.places : uniquePlaces(detours))
            : '0';

        renderFootprints(detours, visible);

        var historyList = $('history-list');
        var historyEmpty = $('history-empty');
        var historyPlaceholder = $('history-placeholder');
        var historyHint = $('history-hint');
        if (historyHint) {
            historyHint.hidden = !visible;
            var anyReplayable = (logged ? detours : []).some(detourHasGeometry);
            historyHint.textContent = anyReplayable
                ? '点击任意一条记录，就能在地图上重走那一次的路线。'
                : '新的偏航会自动保存轨迹；更早的记录只保留了文字。';
        }
        if (historyList) {
            historyList.hidden = !visible;
            historyList.innerHTML = (logged ? detours : []).map(function (d) {
                var replayable = detourHasGeometry(d);
                return '<div class="timeline-row detour-row' + (replayable ? ' is-replayable' : ' is-static') + '"' +
                    ' data-detour-id="' + d.id + '"' +
                    (replayable ? ' role="button" tabindex="0"' : '') +
                    ' aria-label="' + esc(fmtDetourTime(d.created_at) + ' · ' + routeChain(d)) + '">' +
                    '<span class="timeline-dot"></span>' +
                    '<div class="timeline-body detour-body">' +
                    '<div class="detour-item-head"><strong class="detour-title">' + esc(fmtDetourTime(d.created_at)) + '</strong>' +
                    '<span class="detour-km">' + Number(d.distance_km || 0).toFixed(2) + ' km</span></div>' +
                    '<div class="detour-route">' + esc(routeChain(d)) + '</div>' +
                    '<div class="detour-meta">' + esc(detourMeta(d)) + '</div>' +
                    '<div class="detour-foot"><span class="detour-open">' +
                    (replayable ? '回看这次路线 →' : '旧记录 · 轨迹未保存') +
                    '</span></div>' +
                    '</div></div>';
            }).join('');
        }
        if (historyEmpty) historyEmpty.hidden = visible;
        if (historyPlaceholder) historyPlaceholder.hidden = visible;

        var badgeInfo = logged
            ? badgeState(detours, stats)
            : { keys: [], progress: {}, count: 0 };
        var unlocks = {};
        badgeInfo.keys.forEach(function (key) { unlocks[key] = true; });
        var unlocked = badgeInfo.keys.length;
        var badges = document.querySelectorAll('.badge[data-badge]');
        Array.prototype.forEach.call(badges, function (badge) {
            var key = badge.getAttribute('data-badge');
            var on = !!unlocks[key];
            var hint = BADGE_HINTS[key] || '继续探索';
            var progressText = badgeProgressText(key, badgeInfo.progress[key]);
            badge.classList.toggle('locked', !on);
            badge.classList.toggle('unlocked', on);
            badge.classList.remove('next');
            badge.title = on
                ? ('已点亮 · ' + hint)
                : ('未点亮 · ' + hint + (progressText ? '（' + progressText + '）' : ''));
            badge.setAttribute('aria-label', badge.title);
            var sub = badge.querySelector('.badge-sub');
            if (sub) {
                sub.textContent = !logged ? '登录后点亮' : (on ? '已点亮' : (progressText || '未点亮'));
            }
        });
        if (!unlocked) {
            var firstBadge = document.querySelector('.badge[data-badge="first"]');
            if (firstBadge) firstBadge.classList.add('next');
        }
        var cta = $('achievement-cta');
        if (cta) {
            if (!logged) {
                cta.textContent = '登录后开始';
                cta.setAttribute('href', '#/profile');
            } else {
                cta.textContent = unlocked ? '再偏航一次' : '去点亮第一枚';
                cta.setAttribute('href', '#/home');
            }
        }
        var note = $('achievement-note');
        if (note) {
            note.textContent = logged
                ? (unlocked
                    ? ('已点亮 ' + unlocked + ' / 6 枚徽章。继续偏航，更多的城市勋章会慢慢出现。')
                    : '完成第一次偏航即可点亮「初次偏航」。更多徽章会随着你的探索自动解锁。')
                : '登录后，完成的每一次偏航都会点亮对应的城市勋章。';
        }
    }

    async function loadDetours() {
        if (!state.user) {
            state.detours = [];
            renderDetourPages();
            return;
        }
        try {
            var data = await request('/api/detours?limit=20');
            state.detours = (data && data.detours) || [];
            if (data && data.stats) state.stats = data.stats;
        } catch (e) {
            state.detours = [];
        }
        renderDetourPages();
    }

    async function recordDetour(payload) {
        var data = await request('/api/detours', { method: 'POST', body: JSON.stringify(payload) });
        if (data && data.stats) state.stats = data.stats;
        await loadDetours();
        render();
        return data;
    }


    // ===== 收藏 =====
    function favoriteKey(place) {
        var name = String((place && place.name) || '').trim().toLowerCase();
        var lat = Number((place && place.lat) || 0).toFixed(5);
        var lng = Number((place && place.lng) || 0).toFixed(5);
        var type = String((place && place.type) || '').trim();
        return name + '|' + lat + '|' + lng + '|' + type;
    }

    function findFavorite(place) {
        var key = favoriteKey(place);
        for (var i = 0; i < state.favorites.length; i++) {
            if (favoriteKey(state.favorites[i]) === key) return state.favorites[i];
        }
        return null;
    }

    function isFavorite(place) {
        return !!findFavorite(place);
    }

    function fmtFavoriteDate(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return (date.getMonth() + 1) + '月' + date.getDate() + '日';
    }

    function renderFavorites() {
        var grid = $('favorite-grid');
        var empty = $('favorites-empty');
        if (!grid) return;
        var logged = !!state.user;
        var list = state.favorites || [];
        var show = logged && list.length > 0;

        grid.hidden = !show;
        if (empty) empty.hidden = show;
        if (show) {
            grid.innerHTML = list.map(function (f) {
                return '<article class="collection-tile is-filled">' +
                    '<span class="favorite-type">' + esc(f.type || '地点') + '</span>' +
                    '<strong class="favorite-name">' + esc(f.name) + '</strong>' +
                    '<div class="favorite-foot">' +
                    '<span class="favorite-date">' + esc(fmtFavoriteDate(f.created_at)) + '</span>' +
                    '<button type="button" class="favorite-remove" data-fav="' + f.id + '">取消收藏</button>' +
                    '</div></article>';
            }).join('');
        } else {
            grid.innerHTML = '';
        }

        var text = $('favorites-empty-text');
        var cta = $('favorites-empty-cta');
        if (!logged) {
            if (text) text.textContent = '登录后，你收藏的街角、书店和咖啡店会留在这里。';
            if (cta) {
                cta.textContent = '去登录';
                cta.setAttribute('href', '#/profile');
            }
        } else {
            if (text) text.textContent = '在「偏航推荐」的路线卡片里，点途经点上的 ☆ 收藏；也可以一键收藏整条路线。';
            if (cta) {
                cta.textContent = '去生成路线';
                cta.setAttribute('href', '#/home');
            }
        }
    }

    async function loadFavorites() {
        if (!state.user) {
            state.favorites = [];
            renderFavorites();
            return;
        }
        try {
            var data = await request('/api/favorites');
            state.favorites = (data && data.favorites) || [];
            if (data && data.stats) state.stats = data.stats;
        } catch (e) {
            state.favorites = [];
        }
        renderFavorites();
    }

    async function removeFavorite(id) {
        var data = await request('/api/favorites/' + id, { method: 'DELETE' });
        state.favorites = (data && data.favorites) || [];
        if (data && data.stats) state.stats = data.stats;
        render();
        return data;
    }

    async function toggleFavorite(place) {
        var existing = findFavorite(place);
        var data;
        if (existing) {
            data = await request('/api/favorites/' + existing.id, { method: 'DELETE' });
        } else {
            data = await request('/api/favorites', {
                method: 'POST',
                body: JSON.stringify({
                    name: (place && place.name) || '',
                    type: (place && place.type) || '',
                    lat: Number((place && place.lat) || 0),
                    lng: Number((place && place.lng) || 0)
                })
            });
        }
        state.favorites = (data && data.favorites) || [];
        if (data && data.stats) state.stats = data.stats;
        render();
        return !existing;
    }

    var favoriteGrid = $('favorite-grid');
    if (favoriteGrid) {
        favoriteGrid.addEventListener('click', function (event) {
            var btn = event.target && event.target.closest ? event.target.closest('[data-fav]') : null;
            if (!btn) return;
            var id = parseInt(btn.getAttribute('data-fav'), 10);
            if (!id) return;
            btn.disabled = true;
            removeFavorite(id).catch(function (err) {
                btn.disabled = false;
                console.warn('取消收藏失败: ' + (err && err.message));
            });
        });
    }

    // 点击偏航记录 → 在地图上回放那一次的路线
    var historyListEl = $('history-list');
    function findDetourById(id) {
        for (var i = 0; i < state.detours.length; i++) {
            if (String(state.detours[i].id) === String(id)) return state.detours[i];
        }
        return null;
    }
    function openHistoryDetour(row) {
        if (!row) return;
        var detour = findDetourById(row.getAttribute('data-detour-id'));
        if (!detour) return;
        if (window.PianhangReplay && window.PianhangReplay.open) {
            window.PianhangReplay.open(detour);
        }
    }
    if (historyListEl) {
        historyListEl.addEventListener('click', function (event) {
            var row = event.target && event.target.closest
                ? event.target.closest('[data-detour-id]')
                : null;
            if (row) openHistoryDetour(row);
        });
        historyListEl.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            var row = event.target && event.target.closest
                ? event.target.closest('[data-detour-id]')
                : null;
            if (!row) return;
            event.preventDefault();
            openHistoryDetour(row);
        });
    }

    // ===== 渲染 =====
    function initialOf(name) {
        var chars = Array.from((name || '').trim());
        return chars.length ? chars[0] : '偏';
    }

    function joinLabel(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return date.getFullYear() + '.' + String(date.getMonth() + 1).padStart(2, '0') + ' 加入';
    }

    function render() {
        var user = state.user;
        var stats = state.stats || {};
        var logged = !!user;

        if (profileName) profileName.textContent = logged ? user.nickname : '未登录';
        if (profileSub) {
            if (logged) {
                var bits = ['@' + user.username];
                if (user.city) bits.push(user.city);
                var joined = joinLabel(user.created_at);
                if (joined) bits.push(joined);
                profileSub.textContent = bits.join(' · ');
            } else {
                profileSub.textContent = '登录后同步足迹、收藏与成就';
            }
        }
        if (profileAvatar) profileAvatar.textContent = logged ? initialOf(user.nickname) : '偏';

        if (profileLoginBtn) profileLoginBtn.hidden = logged;
        if (profileGuestNote) profileGuestNote.hidden = logged;
        if (profileStats) profileStats.hidden = !logged;
        if (profileDetail) profileDetail.hidden = !logged;

        if (logged) {
            var badgeCount = stats.badges;
            if (typeof badgeCount !== 'number') {
                badgeCount = Array.isArray(stats.badge_keys) ? stats.badge_keys.length : 0;
            }
            $('stat-detours').textContent = String(stats.detours || 0);
            $('stat-distance').textContent = Number(stats.distance_km || 0).toFixed(1);
            $('stat-favorites').textContent = String(stats.favorites || 0);
            $('stat-badges').textContent = String(badgeCount);

            if (profileBio) {
                profileBio.textContent = user.bio || '还没有写下签名。';
                profileBio.classList.toggle('muted', !user.bio);
            }
            if (profileCity) {
                profileCity.textContent = user.city ? '常驻 · ' + user.city : '';
                profileCity.hidden = !user.city;
            }
        }

        // 侧边栏底部同步当前身份
        if (sidebarName) sidebarName.textContent = logged ? user.nickname : '个人中心';
        if (sidebarSub) {
            sidebarSub.textContent = logged
                ? '已登录 · ' + (user.city || '随时可以出发')
                : '未登录 · 把走过的路留下';
        }
        if (profileCard) profileCard.title = logged ? '个人中心 · ' + user.nickname : '个人中心';
        renderProfilePrefs();
        renderSettings();
        renderDetourPages();
        renderFavorites();
    }

    function showError(el, message) {
        if (!el) return;
        el.textContent = message;
        el.hidden = false;
    }

    function hideError(el) {
        if (!el) return;
        el.hidden = true;
        el.textContent = '';
    }

    function setBusy(button, busy, busyText, restoreText) {
        if (!button) return;
        button.disabled = busy;
        button.textContent = busy ? busyText : restoreText;
    }

    // ===== 弹层 =====
    function syncBodyLock() {
        var open = (authModal && !authModal.hidden) || (editModal && !editModal.hidden);
        document.body.classList.toggle('auth-open', !!open);
        // 移动端同时锁住根滚动，弹层宽度才与可视区域一致
        document.documentElement.classList.toggle('auth-open', !!open);
    }

    function setMode(mode) {
        state.mode = mode === 'register' ? 'register' : 'login';
        var isLogin = state.mode === 'login';

        if (authTitle) authTitle.textContent = isLogin ? '回来，继续绕路' : '把走过的路留下';
        if (authSub) {
            authSub.textContent = isLogin
                ? '登录后，足迹、收藏与偏好会跟着你。'
                : '注册后，路线和收藏会保存在账号里。';
        }
        authTabs.forEach(function (tab) {
            var active = tab.getAttribute('data-auth-mode') === state.mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (authNicknameField) authNicknameField.hidden = isLogin;
        if (authPassword) authPassword.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
        if (authSubmit) authSubmit.textContent = isLogin ? '登录' : '创建账号';
        if (authDemoBox) authDemoBox.hidden = !isLogin;
        hideError(authError);
    }

    function openAuth(mode) {
        state.lastFocus = document.activeElement;
        setMode(mode || 'login');
        if (!authModal) return;
        authModal.hidden = false;
        syncBodyLock();
        setTimeout(function () {
            if (authUsername) authUsername.focus();
        }, 60);
    }

    function closeAuth() {
        if (!authModal) return;
        authModal.hidden = true;
        syncBodyLock();
        hideError(authError);
        if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
            try { state.lastFocus.focus(); } catch (e) { /* 忽略 */ }
        }
    }

    function openEdit() {
        if (!state.user) return;
        if (editNickname) editNickname.value = state.user.nickname || '';
        if (editCity) editCity.value = state.user.city || '';
        if (editBio) editBio.value = state.user.bio || '';
        hideError(editError);
        if (!editModal) return;
        editModal.hidden = false;
        syncBodyLock();
        setTimeout(function () {
            if (editNickname) editNickname.focus();
        }, 60);
    }

    function closeEdit() {
        if (!editModal) return;
        editModal.hidden = true;
        syncBodyLock();
        hideError(editError);
    }

    // ===== 登录 / 注册 =====
    async function submitAuth(event) {
        if (event) event.preventDefault();
        var username = (authUsername && authUsername.value || '').trim();
        var password = (authPassword && authPassword.value || '');
        var nickname = (authNickname && authNickname.value || '').trim();
        var isLogin = state.mode === 'login';

        if (!username) {
            showError(authError, '请先填写用户名');
            authUsername && authUsername.focus();
            return;
        }
        if (!/^[A-Za-z0-9_一-龥]{3,24}$/.test(username)) {
            showError(authError, '用户名需为 3–24 位中文、字母、数字或下划线');
            return;
        }
        if (password.length < 6) {
            showError(authError, '密码至少 6 位');
            return;
        }

        var restoreText = isLogin ? '登录' : '创建账号';
        setBusy(authSubmit, true, isLogin ? '正在登录…' : '正在创建…', restoreText);
        hideError(authError);

        var guestPrefs = localPrefs();
        var guestCustom = !!(prefsModule() && prefsModule().hasCustom());

        try {
            var data = await request(isLogin ? '/api/auth/login' : '/api/auth/register', {
                method: 'POST',
                body: JSON.stringify(
                    isLogin
                        ? { username: username, password: password }
                        : { username: username, password: password, nickname: nickname }
                )
            });
            state.user = data.user;
            state.stats = data.stats;
            await adoptPreferencesAfterAuth(data.user, isLogin, guestPrefs, guestCustom);
            render();
            loadDetours();
            loadFavorites();
            if (authForm) authForm.reset();
            closeAuth();
        } catch (err) {
            showError(authError, err.message);
        } finally {
            setBusy(authSubmit, false, '', restoreText);
        }
    }

    // ===== 编辑资料 =====
    async function submitEdit(event) {
        if (event) event.preventDefault();
        var nickname = (editNickname && editNickname.value || '').trim();
        if (!nickname) {
            showError(editError, '昵称不能为空');
            editNickname && editNickname.focus();
            return;
        }

        setBusy(editSubmit, true, '正在保存…', '保存');
        hideError(editError);

        try {
            var data = await request('/api/auth/profile', {
                method: 'PATCH',
                body: JSON.stringify({
                    nickname: nickname,
                    city: (editCity && editCity.value || '').trim(),
                    bio: (editBio && editBio.value || '').trim()
                })
            });
            state.user = data.user;
            render();
            closeEdit();
        } catch (err) {
            if (err.status === 401) {
                state.user = null;
                state.stats = null;
                render();
                closeEdit();
                openAuth('login');
                showError(authError, '登录已过期，请重新登录');
            } else {
                showError(editError, err.message);
            }
        } finally {
            setBusy(editSubmit, false, '', '保存');
        }
    }

    // ===== 退出 =====
    async function logout() {
        try {
            await request('/api/auth/logout', { method: 'POST' });
        } catch (e) { /* 断网时也允许本地退出 */ }
        state.user = null;
        state.stats = null;
        state.detours = [];
        state.favorites = [];
        // 退出后回到本机默认偏好，避免下一位游客看到上一个账号的设置
        persistLocalPrefs(PREF_DEFAULT);
        settingsDraft = null;
        settingsDirty = false;
        settingsNotice = '';
        renderSettings(true);
        render();
    }

    // ===== 会话恢复 =====
    async function loadMe() {
        try {
            var data = await request('/api/auth/me');
            if (data && data.authenticated) {
                state.user = data.user;
                state.stats = data.stats;
                // 账号偏好优先；没有设置过就用默认值，避免把上一台设备/上一个账号的偏好带进来
                persistLocalPrefs(data.user.preferences_set ? data.user.preferences : PREF_DEFAULT);
            } else {
                state.user = null;
                state.stats = null;
            }
        } catch (e) {
            // 后端未启动或离线时保持游客态，不打断页面
            state.user = null;
            state.stats = null;
        }
        if (!settingsDirty) {
            settingsDraft = null;
            settingsNotice = '';
        }
        render();
        renderSettings();
        loadDetours();
        loadFavorites();
    }

    // ===== 偏好设置事件 =====
    function onSettingOptionClick(event, attr, apply) {
        var btn = event.target && event.target.closest
            ? event.target.closest('button[' + attr + ']')
            : null;
        if (!btn || !settingsDraft) return;
        apply(btn.getAttribute(attr));
        markSettingsDirty();
    }

    if (settingMode) {
        settingMode.addEventListener('click', function (event) {
            onSettingOptionClick(event, 'data-mode', function (value) {
                settingsDraft.default_mode = value;
            });
        });
    }
    if (settingPace) {
        settingPace.addEventListener('click', function (event) {
            onSettingOptionClick(event, 'data-pace', function (value) {
                settingsDraft.pace = value;
            });
        });
    }
    if (settingInterests) {
        settingInterests.addEventListener('click', function (event) {
            var btn = event.target && event.target.closest
                ? event.target.closest('button[data-interest]')
                : null;
            if (!btn || !settingsDraft) return;
            var value = btn.getAttribute('data-interest');
            var index = settingsDraft.interests.indexOf(value);
            if (index >= 0) settingsDraft.interests.splice(index, 1);
            else settingsDraft.interests.push(value);
            markSettingsDirty();
        });
    }
    if (settingSaveBtn) settingSaveBtn.addEventListener('click', saveSettings);
    if (settingResetBtn) {
        settingResetBtn.addEventListener('click', function () {
            settingsDraft = clonePrefs(PREF_DEFAULT);
            markSettingsDirty();
        });
    }
    if (settingLoginBtn) settingLoginBtn.addEventListener('click', function () { openAuth('login'); });

    window.addEventListener('pianhang:prefs', function (event) {
        if (settingsDirty) return;
        settingsDraft = clonePrefs((event && event.detail) || currentPrefs());
        renderSettings();
        renderProfilePrefs();
    });

    // ===== 事件 =====
    if (profileLoginBtn) profileLoginBtn.addEventListener('click', function () { openAuth('login'); });
    if (profileEditBtn) profileEditBtn.addEventListener('click', openEdit);
    if (profileLogoutBtn) profileLogoutBtn.addEventListener('click', logout);

    authTabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            setMode(tab.getAttribute('data-auth-mode'));
        });
    });

    if (authForm) authForm.addEventListener('submit', submitAuth);
    if (editForm) editForm.addEventListener('submit', submitEdit);

    if (authClose) authClose.addEventListener('click', closeAuth);
    if (editClose) editClose.addEventListener('click', closeEdit);

    if (authModal) {
        authModal.addEventListener('click', function (e) {
            if (e.target === authModal) closeAuth();
        });
    }
    if (editModal) {
        editModal.addEventListener('click', function (e) {
            if (e.target === editModal) closeEdit();
        });
    }

    if (authDemo) {
        authDemo.addEventListener('click', function () {
            setMode('login');
            if (authUsername) authUsername.value = 'demo';
            if (authPassword) authPassword.value = 'pianhang';
            if (authForm && authForm.requestSubmit) authForm.requestSubmit();
            else if (authForm) authForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        });
    }

    [authUsername, authPassword, authNickname].forEach(function (input) {
        if (input) input.addEventListener('input', function () { hideError(authError); });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (authModal && !authModal.hidden) closeAuth();
        else if (editModal && !editModal.hidden) closeEdit();
    });

    // 从其它页面回到个人中心时刷新会话，避免多标签页状态过期
    window.addEventListener('hashchange', function () {
        var route = (location.hash || '').replace(/^#\/?/, '').split('/')[0].split('?')[0];
        if (route === 'profile') {
            if (!state.user) loadMe();
            else render();
        }
        if (route === 'settings') {
            renderSettings(!settingsDirty);
        }
        if (route === 'footprints' || route === 'history' || route === 'achievements') {
            if (state.user) loadDetours();
            else renderDetourPages();
        }
        if (route === 'favorites') {
            if (state.user) loadFavorites();
            else renderFavorites();
        }
    });

    // 供 app.js 在进入导航时写入真实偏航记录
    window.PianhangAuth = {
        isLoggedIn: function () { return !!state.user; },
        openLogin: function () { openAuth('login'); },
        recordDetour: recordDetour,
        isFavorite: isFavorite,
        toggleFavorite: toggleFavorite,
        refresh: loadMe,
        refreshDetours: loadDetours,
        refreshFavorites: loadFavorites
    };

    render();
    loadMe();
})();
