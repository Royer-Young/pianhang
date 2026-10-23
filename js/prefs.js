// 偏航 · 偏好设置的本地缓存与共享约定
// 游客保存在本机，登录后由 auth.js 与账号同步；app.js 读取后用于预选与路线生成。

(function () {
    'use strict';

    var KEY = 'pianhang_prefs_v1';
    var MODES = ['walk', 'bike', 'ebike'];
    var PACES = ['slow', 'steady', 'far'];
    var INTERESTS = ['公园', '咖啡店', '书店', '博物馆', '广场', '景点'];
    var DEFAULT = { default_mode: 'walk', pace: 'steady', interests: [] };
    var MODE_LABELS = { walk: '步行', bike: '骑行 · 自行车', ebike: '骑行 · 电动车' };
    var PACE_LABELS = { slow: '慢慢逛', steady: '适中', far: '走远一点' };

    function clone(prefs) {
        return {
            default_mode: prefs.default_mode,
            pace: prefs.pace,
            interests: prefs.interests.slice()
        };
    }

    function normalize(raw) {
        var data = raw && typeof raw === 'object' ? raw : {};
        var interests = [];
        if (Array.isArray(data.interests)) {
            data.interests.forEach(function (item) {
                var text = String(item == null ? '' : item).trim();
                if (INTERESTS.indexOf(text) >= 0 && interests.indexOf(text) < 0) {
                    interests.push(text);
                }
            });
        }
        return {
            default_mode: MODES.indexOf(data.default_mode) >= 0 ? data.default_mode : DEFAULT.default_mode,
            pace: PACES.indexOf(data.pace) >= 0 ? data.pace : DEFAULT.pace,
            interests: interests.slice(0, INTERESTS.length)
        };
    }

    function same(a, b) {
        if (!a || !b) return false;
        if (a.default_mode !== b.default_mode || a.pace !== b.pace) return false;
        if (a.interests.length !== b.interests.length) return false;
        for (var i = 0; i < a.interests.length; i++) {
            if (a.interests[i] !== b.interests[i]) return false;
        }
        return true;
    }

    function read() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return null;
            return normalize(JSON.parse(raw));
        } catch (e) {
            return null;
        }
    }

    function emit(prefs) {
        try {
            window.dispatchEvent(new CustomEvent('pianhang:prefs', { detail: clone(prefs) }));
        } catch (e) {
            // 极老的浏览器不支持 CustomEvent 时，其他模块仍会读取最新缓存
        }
    }

    function set(prefs) {
        var clean = normalize(prefs);
        try {
            localStorage.setItem(KEY, JSON.stringify(clean));
        } catch (e) { /* 隐私模式下只影响本机缓存 */ }
        emit(clean);
        return clone(clean);
    }

    function get() {
        return clone(read() || DEFAULT);
    }

    function hasLocal() {
        return read() !== null;
    }

    function hasCustom() {
        var local = read();
        return !!local && !same(local, DEFAULT);
    }

    window.PianhangPrefs = {
        KEY: KEY,
        DEFAULT: clone(DEFAULT),
        MODES: MODES.slice(),
        PACES: PACES.slice(),
        INTERESTS: INTERESTS.slice(),
        MODE_LABELS: MODE_LABELS,
        PACE_LABELS: PACE_LABELS,
        normalize: normalize,
        same: same,
        get: get,
        set: set,
        hasLocal: hasLocal,
        hasCustom: hasCustom,
        isDefault: function (prefs) { return same(normalize(prefs), DEFAULT); }
    };
})();
