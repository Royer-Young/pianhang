// 偏航 Web App - 前端主逻辑

(function () {
    'use strict';

    // AI 后端地址：构建时由 build.js 注入 window.__API_BASE__（SAME_ORIGIN 时为空字符串表示同源）
    var AI_BASE = 'http://localhost:8001';

    // ===== 时间选择：自选时间轮盘 =====
    var selectedMinutes = null;
    var startBtn = document.getElementById('start-btn');
    var startBtnLabel = document.getElementById('start-btn-label');
    var viewStart = document.getElementById('view-start');
    var viewExplore = document.getElementById('view-explore');
    var enteredExplore = false;
    var timePickBtn = document.getElementById('time-pick-btn');
    var timePickValue = document.getElementById('time-pick-value');
    var timePickUnit = document.getElementById('time-pick-unit');
    var timeChosenEl = document.getElementById('time-chosen');
    var wheelModal = document.getElementById('wheel-modal');
    var wheelHours = document.getElementById('wheel-hours');
    var wheelMinutes = document.getElementById('wheel-minutes');
    var wheelValueEl = document.getElementById('wheel-value');
    var wheelCancel = document.getElementById('wheel-cancel');
    var wheelOk = document.getElementById('wheel-ok');
    var ITEM_H = 48;            // 轮盘每项高度(px)
    var wheelHoursVal = 1;      // 轮盘当前小时
    var wheelMinutesVal = 0;    // 轮盘当前分钟

    // 时间 → 搜索半径(米)：约 40m/分钟
    function radiusByMin(minutes) {
        return Math.round(minutes * 40);
    }

    function updateStartButton() {
        startBtn.disabled = (selectedMinutes === null);
        if (startBtnLabel) {
            startBtnLabel.textContent = selectedMinutes === null
                ? '开始偏航'
                : '开始偏航 · ' + formatDuration(selectedMinutes);
        }
    }

    // 自选按钮保持结构，只更新数值文本
    function resetTimePickLabel() {
        if (timePickValue) timePickValue.textContent = '自选';
        if (timePickUnit) timePickUnit.textContent = '时长';
    }

    function formatDuration(minutes) {
        if (minutes < 60) return minutes + ' 分钟';
        var h = Math.floor(minutes / 60), m = minutes % 60;
        return h + ' 小时' + (m ? (' ' + m + ' 分钟') : '');
    }

    // ===== 主流程的轻量进度提示与视图入场 =====
    var homeContainer = document.querySelector('#page-home .container');
    var flowStepsEl = document.getElementById('flow-steps');
    var flowStepEls = flowStepsEl ? flowStepsEl.querySelectorAll('.flow-step') : [];
    var nowStripEl = document.getElementById('now-strip');

    function setFlowStep(step) {
        if (flowStepsEl) flowStepsEl.hidden = !step;
        // 偏好页自带更贴近表单的天气上下文，避免同一屏重复出现两份天气
        if (nowStripEl) nowStripEl.hidden = !step || step === 3;
        if (homeContainer) homeContainer.dataset.flow = String(step || 0);
        Array.prototype.forEach.call(flowStepEls, function (el, i) {
            var n = i + 1;
            el.classList.toggle('is-active', n === step);
            el.classList.toggle('is-done', n < step);
        });
    }

    function revealView(el) {
        if (!el) return;
        el.classList.remove('view-enter');
        void el.offsetWidth;
        el.classList.add('view-enter');
        setTimeout(function () { el.classList.remove('view-enter'); }, 520);
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ===== 偏好设置：出行方式 + 地点偏好 =====
    // 出行方式 → 步速(m/min)、OSRM profile、搜索半径倍率、标签
    var MODE_CONFIG = {
        walk:  { speed: 80,  profile: 'foot',   radiusMul: 1.0, label: '步行' },
        bike:  { speed: 250, profile: 'bike',   radiusMul: 1.8, label: '骑行·自行车' },
        ebike: { speed: 400, profile: 'bike',   radiusMul: 2.5, label: '骑行·电动车' }
    };
    var selectedMode = 'walk';           // 当前出行方式
    var selectedPlaceTypes = [];         // 选中的地点偏好(多选)
    var prefSelectionTouched = false;    // 本次流程里是否手动改过预选
    var prefPace = 'steady';             // 偏好设置里的探索节奏
    // 节奏 → 搜索半径、距离预算与途经点数量
    var PACE_CONFIG = {
        slow:   { radiusMul: 0.85, budgetMul: 0.9,  stops: 2, label: '慢慢逛' },
        steady: { radiusMul: 1.0,  budgetMul: 1.0,  stops: 3, label: '适中' },
        far:    { radiusMul: 1.2,  budgetMul: 1.12, stops: 4, label: '走远一点' }
    };
    function paceConfig() {
        return PACE_CONFIG[prefPace] || PACE_CONFIG.steady;
    }
    var hasDestination = false;          // 是否有目的地
    var returnToStart = false;           // 无目的地模式下是否回到起点（true=回起点; false=走到哪算哪）
    var startCoords = null;              // 起点坐标 {lat,lng}
    var endCoords = null;                // 终点坐标 {lat,lng}
    var startPlace = null;               // 起点地点信息 {name,address,lat,lng,kind}
    var endPlace = null;                 // 终点地点信息
    var userCity = '';                   // IP 定位得到的城市名
    var ambientWeather = null;           // 界面上展示的天气（与算法用的 currentWeather 分开）
    var ambientWeatherKey = '';
    var ambientWeatherLabel = '当前位置';
    var ambientWeatherError = false;

    var viewDest = document.getElementById('view-dest');
    var viewPref = document.getElementById('view-pref');
    var destYes = document.getElementById('dest-yes');
    var destRoundtrip = document.getElementById('dest-roundtrip');
    var destWander = document.getElementById('dest-wander');

    // 开始偏航 → 显示"是否有目的地"问询屏
    function showDestQuestion() {
        if (viewStart) viewStart.hidden = true;
        if (viewDest) { viewDest.hidden = false; revealView(viewDest); }
        setFlowStep(2);
    }

    // 进入偏航偏好界面：隐藏问询屏、显示偏好视图，有目的地时显示起终点
    function enterPrefView(hasDest, returnRoundtrip) {
        hasDestination = !!hasDest;
        returnToStart = !hasDest && !!returnRoundtrip;
        if (viewDest) viewDest.hidden = true;
        if (viewPref) { viewPref.hidden = false; revealView(viewPref); }
        var routeBlock = document.getElementById('route-block');
        if (routeBlock) routeBlock.hidden = !hasDestination;
        if (!hasDestination) clearPlace('end', { keepInput: true, silent: true });
        setFlowStep(3);
        // 首次进入时定位用户(后续生成路线时需要)
        if (!enteredExplore) {
            enteredExplore = true;
            if (!userLocation) ensureUserLocation();
        }
    }

    // 从偏好界面进入推荐界面：隐藏偏好、显示推荐视图(加载中)、生成路线
    function enterExploreFromPref() {
        if (viewPref) viewPref.hidden = true;
        var vr = document.getElementById('view-routes');
        var rb = document.getElementById('routes-body');
        if (vr) { vr.hidden = false; revealView(vr); }
        setFlowStep(0);
        if (rb) rb.innerHTML = renderRoutesLoading();
        startRoutesProgress();
        loadCandidates();
    }

    var prefSection = document.querySelector('.pref-section');
    var userLocation = null;  // 用户位置(静默IP定位)，作为默认起点，不展示UI
    var userLocationPromise = null;  // 定位进行中的 Promise，避免重复请求
    var userMarker = null;    // 用户位置标记(常驻地图)

    // 统一更新用户位置：移动地图标记 + 记录到 userLocation + 回调
    function applyUserLocation(lat, lng, source, accuracy, city) {
        userLocation = { lat: lat, lng: lng };
        if (city) userCity = city;
        if (map) {
            map.setView(toMapLatLng(lat, lng), 15);
            if (userMarker) {
                userMarker.setLatLng(toMapLatLng(lat, lng));
            } else {
                userMarker = L.circleMarker(toMapLatLng(lat, lng), {
                    radius: 10, color: '#ffffff', fillColor: '#3b82f6',
                    fillOpacity: 1, weight: 3
                }).bindPopup('<div style="font-size:14px"><b>你的位置</b></div>').addTo(map);
            }
        }
        updateUserPlaceDefaults();
        if (!startPlace) {
            refreshAmbientWeather(lat, lng, userCity || '当前位置');
        }
        console.log('[' + source + (accuracy ? ' ±' + Math.round(accuracy) + 'm' : '') + '] 已定位用户位置: (' + lat.toFixed(4) + ',' + lng.toFixed(4) + ')');
    }

    // IP 定位：优先走后端同源代理 /api/ip（无 CORS/混合内容问题）；失败则回退公开接口
    // 返回 Promise，resolve 位置或 null
    function ipLocate() {
        var urls = [
            AI_BASE + '/api/ip',
            'https://ipapi.co/json/',
            'https://ipwho.is/'
        ];
        var idx = 0;
        function tryNext() {
            if (idx >= urls.length) return Promise.resolve(null);
            var url = urls[idx++];
            var controller = new AbortController();
            var timer = setTimeout(function () { controller.abort(); }, 6000);
            return fetch(url, { signal: controller.signal }).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (d) {
                clearTimeout(timer);
                if (d.error) throw new Error(d.error);
                var lat = parseFloat(d.lat), lon = parseFloat(d.lon || d.lng || d.longitude);
                if (isNaN(lat) || isNaN(lon)) throw new Error('无坐标');
                return { lat: lat, lng: lon, city: d.city || '' };
            }).catch(function (err) {
                clearTimeout(timer);
                console.warn('IP定位端点失败 ' + url + ': ' + err.message);
                return tryNext();
            });
        }
        return tryNext();
    }

    // 静默定位：GPS 精确优先 → IP 粗定位兜底 → 地图中心
    // 返回 Promise<{lat, lng, source}>，resolve 位置或 null
    function locateUser(callback) {
        var tasks = [];
        var resolved = false;
        var userLocationPromise;

        // GPS 精确定位（6s 超时，超时后不阻止 IP 兜底）
        if (navigator.geolocation) {
            userLocationPromise = new Promise(function (resolve) {
                var done = function (result, source) {
                    if (!resolved) {
                        resolved = true;
                        if (result) {
                            applyUserLocation(result.lat, result.lng, source, result.accuracy || null, result.city || '');
                        } else {
                            if (map) map.setView([31.2304, 121.4737], 13);
                            refreshAmbientWeather(31.2304, 121.4737, '当前位置');
                        }
                        resolve(result ? { lat: result.lat, lng: result.lng, source: source } : null);
                    }
                };
                var onSuccess = function (pos) {
                    done({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }, 'GPS');
                };
                var onError = function () { done(null, 'gps-error'); };
                navigator.geolocation.getCurrentPosition(onSuccess, onError, { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 });
                setTimeout(function () { done(null, 'gps-timeout'); }, 6500);
            });
            tasks.push(userLocationPromise);
        }

        // IP 定位（4s 超时，作为兜底）
        var ipPromise = ipLocate().then(function (ip) {
            if (ip) {
                applyUserLocation(ip.lat, ip.lng, 'IP', null, ip.city);
            } else if (!resolved) {
                if (map) map.setView([31.2304, 121.4737], 13);
                refreshAmbientWeather(31.2304, 121.4737, '当前位置');
            }
            return ip ? { lat: ip.lat, lng: ip.lng, source: 'IP' } : null;
        });
        tasks.push(ipPromise);

        // 取第一个成功的（GPS 优先，因为先发起；IP 会在 GPS 超时后兜底）
        var race = Promise.race(tasks);
        if (callback) race.then(callback);
        return race;
    }

    // 等待定位完成（最多 ms 毫秒）：默认起点要在生成路线前就绪
    function ensureUserLocation(ms) {
        if (userLocation) return Promise.resolve(userLocation);
        if (!userLocationPromise) userLocationPromise = locateUser();
        var timeout = new Promise(function (resolve) {
            setTimeout(function () { resolve(null); }, ms || 4000);
        });
        return Promise.race([userLocationPromise, timeout]).then(function () {
            return userLocation;
        });
    }

    function mapCenterWgs() {
        var cc = map ? map.getCenter() : { lat: 31.2304, lng: 121.4737 };
        return gcj02ToWgs84(cc.lat, cc.lng);
    }

    // ===== 时间轮盘：小时 + 分钟滚动选择（滚轮精确控制） =====
    var timePresets = document.querySelectorAll('.time-option[data-minutes]');
    var WHEEL_MAX_HOURS = 4; // 小时上限

    function pad2(n) { return ('0' + n).slice(-2); }
    function buildWheel(el, count, fmt) {
        var html = '';
        for (var i = 0; i < count; i++) {
            html += '<div class="wheel-item" data-v="' + i + '">' + fmt(i) + '</div>';
        }
        el.innerHTML = html;
    }
    function wheelScrollTo(el, idx) {
        el.scrollTop = idx * ITEM_H;
    }
    // 读取当前列选中索引（分钟列 0-11 → 值*5）
    function readWheelIdx(el) {
        return Math.round(el.scrollTop / ITEM_H);
    }

    // 轮盘实时显示当前选中时间
    function updateWheelValue() {
        wheelHoursVal = readWheelIdx(wheelHours);
        wheelMinutesVal = readWheelIdx(wheelMinutes) * 5;
        var total = wheelHoursVal * 60 + wheelMinutesVal;
        if (wheelValueEl) wheelValueEl.textContent = formatDuration(total) || '请选择时间';
    }

    function openWheel() {
        if (!wheelModal) return;
        // 定位到当前已选时间（默认 1 小时 0 分）
        var h = Math.floor((selectedMinutes || 60) / 60);
        var m = Math.round(((selectedMinutes || 60) % 60) / 5);
        if (h > WHEEL_MAX_HOURS) h = WHEEL_MAX_HOURS;
        if (m > 11) m = 11;
        wheelScrollTo(wheelHours, h);
        wheelScrollTo(wheelMinutes, m);
        wheelHoursVal = h; wheelMinutesVal = m * 5;
        updateWheelValue();
        wheelModal.hidden = false;
    }
    function closeWheel() {
        if (wheelModal) wheelModal.hidden = true;
    }
    function confirmWheel() {
        var total = wheelHoursVal * 60 + wheelMinutesVal;
        if (total < 10) { alert('偏航时间至少 10 分钟'); return; }
        selectedMinutes = total;
        closeWheel();
        timePresets.forEach(function (x) { x.classList.remove('active'); });
        if (timePickBtn) timePickBtn.classList.add('active');
        if (timePickValue) timePickValue.textContent = String(total);
        if (timePickUnit) timePickUnit.textContent = '分钟';
        if (timeChosenEl) { timeChosenEl.textContent = '已选时间：' + formatDuration(total); timeChosenEl.hidden = false; }
        updateStartButton();
    }

    // 预设按钮：30/60 分钟
    function selectPreset(el) {
        selectedMinutes = parseInt(el.dataset.minutes, 10);
        timePresets.forEach(function (x) { x.classList.remove('active'); });
        el.classList.add('active');
        if (timePickBtn) timePickBtn.classList.remove('active');
        resetTimePickLabel();
        if (timeChosenEl) { timeChosenEl.textContent = '已选时间：' + formatDuration(selectedMinutes); timeChosenEl.hidden = false; }
        updateStartButton();
    }
    timePresets.forEach(function (el) {
        el.addEventListener('click', function () { selectPreset(el); });
    });

    if (timePickBtn) timePickBtn.addEventListener('click', openWheel);
    if (wheelCancel) wheelCancel.addEventListener('click', closeWheel);
    if (wheelOk) wheelOk.addEventListener('click', confirmWheel);
    // 点击遮罩空白处关闭
    if (wheelModal) wheelModal.addEventListener('click', function (e) {
        if (e.target === wheelModal) closeWheel();
    });

    // 滚轮事件：拦截默认滚动，精确按格移动（一格=ITEM_H；快速滚动按幅度转多格）
    function bindWheelCol(el) {
        el.addEventListener('wheel', function (e) {
            e.preventDefault();
            var maxTop = el.scrollHeight - el.clientHeight;
            var steps = Math.max(1, Math.round(Math.abs(e.deltaY) / 100));
            if (e.deltaY < 0) steps = -steps;
            var target = el.scrollTop + steps * ITEM_H;
            target = Math.max(0, Math.min(target, maxTop));
            el.scrollTop = target;
            updateWheelValue();
        }, { passive: false });
        // 滚动结束（含触摸/键盘）实时更新
        var timer = null;
        el.addEventListener('scroll', function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(updateWheelValue, 60);
        });
    }
    if (wheelHours) { buildWheel(wheelHours, WHEEL_MAX_HOURS + 1, function (i) { return i + '时'; }); bindWheelCol(wheelHours); }
    if (wheelMinutes) { buildWheel(wheelMinutes, 12, function (i) { return pad2(i * 5) + '分'; }); bindWheelCol(wheelMinutes); }

    // ===== 火星坐标转换（WGS-84 ↔ GCJ-02，公知算法，用于对齐高德瓦片） =====
    // 地图数据(OSRM/Overpass/GPS/IP)均为 WGS-84；高德瓦片为 GCJ-02，
    // 所有绘制到地图的元素在显示前统一转成 GCJ-02，保证与道路精确对齐。
    var GCJ_A = 6378245.0;
    var GCJ_EE = 0.00669342162296594323;
    function gcjOutOfChina(lat, lng) {
        return (lng < 72.004 || lng > 137.8347) || (lat < 0.8293 || lat > 55.8271);
    }
    function gcjTransformLat(x, y) {
        var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }
    function gcjTransformLng(x, y) {
        var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
        return ret;
    }
    function wgs84ToGcj02(lat, lng) {
        if (gcjOutOfChina(lat, lng)) return { lat: lat, lng: lng };
        var dLat = gcjTransformLat(lng - 105.0, lat - 35.0);
        var dLng = gcjTransformLng(lng - 105.0, lat - 35.0);
        var radLat = lat / 180.0 * Math.PI;
        var magic = Math.sin(radLat);
        magic = 1 - GCJ_EE * magic * magic;
        var sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
        dLng = (dLng * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
        return { lat: lat + dLat, lng: lng + dLng };
    }
    function gcj02ToWgs84(lat, lng) {
        if (gcjOutOfChina(lat, lng)) return { lat: lat, lng: lng };
        var g = wgs84ToGcj02(lat, lng);
        return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
    }
    // WGS-84 → 地图显示坐标（高德瓦片）
    function toMapLatLng(lat, lng) {
        var g = wgs84ToGcj02(lat, lng);
        return [g.lat, g.lng];
    }

    // ===== 地图初始化 =====
    var map = null;

    if (typeof L === 'undefined') {
        console.error('Leaflet 未加载，无法初始化地图');
    } else {
        map = L.map('map', {
            zoomControl: false,
            attributionControl: true
        }).setView(toMapLatLng(31.2304, 121.4737), 13); // 默认上海中心(WGS-84→GCJ-02)
        // 缩放控件置于右下，避开顶部导航浮层
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // 高德瓦片（国内稳定；GCJ-02，配合上面的坐标转换与数据对齐）
        L.tileLayer('https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
            attribution: '&copy; 高德地图',
            maxZoom: 19,
            subdomains: ['1', '2', '3', '4']
        }).addTo(map);

        // iframe/容器尺寸变化时重算地图边界
        setTimeout(function () { map.invalidateSize(); }, 200);
        window.addEventListener('resize', function () { map.invalidateSize(); });

        // 定位用户真实位置作为起点
        locateUser();
    }

    // ===== POI 配置 =====
    // 公园/咖啡店/书店/博物馆/广场/景点
    var POI_CATEGORIES = [
        { key: 'park',       label: '公园',   osm: { leisure: 'park' },      color: '#22c55e',
          photonTags: ['leisure:park', 'leisure:garden'] },
        { key: 'cafe',       label: '咖啡店', osm: { amenity: 'cafe' },      color: '#b45309',
          photonTags: ['amenity:cafe'] },
        { key: 'books',      label: '书店',   osm: { shop: 'books' },        color: '#3b82f6',
          photonTags: ['shop:books'] },
        { key: 'museum',     label: '博物馆', osm: { tourism: 'museum' },    color: '#9333ea',
          photonTags: ['tourism:museum', 'tourism:gallery'] },
        { key: 'plaza',      label: '广场',   osm: { place: 'square' },      color: '#f97316',
          photonTags: ['place:square'] },
        { key: 'attraction', label: '景点',   osm: { tourism: 'attraction' },color: '#ef4444',
          photonTags: ['tourism:attraction', 'tourism:viewpoint', 'historic:monument'] }
    ];

    function poiCategoryByLabel(label) {
        for (var i = 0; i < POI_CATEGORIES.length; i++) {
            if (POI_CATEGORIES[i].label === label) return POI_CATEGORIES[i];
        }
        return null;
    }

    // 构建 Overpass QL 查询：围绕中心点 radius 米内的6类POI
    function buildOverpassQuery(lat, lng, radius) {
        var filters = POI_CATEGORIES.map(function (c) {
            var k = Object.keys(c.osm)[0];
            return 'nwr["' + k + '"="' + c.osm[k] + '"](around:' + radius + ',' + lat + ',' + lng + ');';
        }).join('');
        return '[out:json][timeout:25];(' + filters + ');out center tags;';
    }

    // 根据OSM标签判定POI类型
    function classifyPOI(tags) {
        for (var i = 0; i < POI_CATEGORIES.length; i++) {
            var c = POI_CATEGORIES[i];
            var k = Object.keys(c.osm)[0];
            if (tags[k] === c.osm[k]) return c;
        }
        return null;
    }

    // 将Overpass返回的元素转为POI对象（名称/类型/经纬度），按位置+名称去重
    function elementsToPOIs(elements) {
        var pois = [];
        var seen = {};
        elements.forEach(function (el) {
            var tags = el.tags || {};
            var cat = classifyPOI(tags);
            if (!cat) return;
            var lat = el.lat !== undefined ? el.lat : (el.center ? el.center.lat : undefined);
            var lng = el.lon !== undefined ? el.lon : (el.center ? el.center.lon : undefined);
            if (lat === undefined || lng === undefined) return;
            var name = tags.name || cat.label;
            var key = lat.toFixed(5) + ',' + lng.toFixed(5) + ':' + name;
            if (seen[key]) return;
            seen[key] = true;
            pois.push({ lat: lat, lng: lng, name: name, type: cat.label, color: cat.color });
        });
        return pois;
    }

    var poiLayer = map ? L.layerGroup().addTo(map) : null;
    var routeLayer = map ? L.layerGroup().addTo(map) : null;
    var SELECTED_COUNT = 3; // 本次偏航随机挑选的途经点数量
    var WALK_SPEED_M_PER_MIN = 80; // 步行速度 ~4.8km/h
    // 默认探索偏好(类别权重，越大越偏好)，后续可接入用户输入
    var DEFAULT_PREFERENCES = { '公园': 1.0, '咖啡店': 0.9, '书店': 1.0, '博物馆': 1.3, '广场': 1.0, '景点': 1.2 };
    var currentWeather = null; // 当前天气(由Open-Meteo获取)，影响打分偏好与可行半径

    // ===== 天气（Open-Meteo公开免费接口，无key） =====
    var EXTREME_HOT = 33, EXTREME_COLD = 2; // 极热/极冷阈值(℃)
    var WEATHER_DIST_FACTOR = 0.6; // 极端温度下可行半径/预算折扣

    // WMO weather_code → 中文描述
    function wmoDesc(code) {
        var m = { 0: '晴', 1: '大体晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
            51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
            61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
            71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
            80: '阵雨', 81: '阵雨', 82: '阵雨', 85: '阵雪', 86: '阵雪',
            95: '雷暴', 96: '雷暴伴冰雹', 99: '雷暴伴冰雹' };
        return m[code] != null ? m[code] : '未知';
    }

    // 解析降水场景与极端温度(二者独立)
    function analyzeWeather(code, tempC) {
        var precip;
        if (code === 0 || code === 1) precip = 'sunny';
        else if (code === 2 || code === 3) precip = 'cloudy';
        else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) precip = 'rain';
        else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) precip = 'snow';
        else precip = 'cloudy';
        var extreme = null;
        if (tempC !== null && tempC !== undefined) {
            if (tempC >= EXTREME_HOT) extreme = 'hot';
            else if (tempC <= EXTREME_COLD) extreme = 'cold';
        }
        return { precip: precip, extreme: extreme };
    }

    // 按天气调整类别偏好：晴→户外, 雨/雪→室内
    function buildWeatherPreferences(precip, basePrefs) {
        var p = {};
        Object.keys(basePrefs).forEach(function (k) { p[k] = basePrefs[k]; });
        var OUTDOOR = ['公园', '广场', '景点'];
        var INDOOR = ['博物馆', '书店', '咖啡店'];
        if (precip === 'rain' || precip === 'snow') {
            INDOOR.forEach(function (k) { if (p[k] != null) p[k] *= 1.4; });
            OUTDOOR.forEach(function (k) { if (p[k] != null) p[k] *= 0.5; });
        } else if (precip === 'sunny') {
            OUTDOOR.forEach(function (k) { if (p[k] != null) p[k] *= 1.4; });
            INDOOR.forEach(function (k) { if (p[k] != null) p[k] *= 0.8; });
        }
        return p;
    }

    // 极热/极冷→减少步行距离(可行半径折扣)
    function feasibleRadiusFor(minutes, extreme) {
        var r = Math.round(minutes * 32); // 单点可达半径 ≈ 32m/分钟
        return extreme ? Math.round(r * WEATHER_DIST_FACTOR) : r;
    }

    function fetchWeather(lat, lng, cb) {
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
            '&current=temperature_2m,weather_code&timezone=auto';
        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            var cur = data.current || {};
            var code = cur.weather_code;
            var tempC = cur.temperature_2m;
            var a = analyzeWeather(code, tempC);
            cb(null, {
                code: code, tempC: tempC, precip: a.precip, extreme: a.extreme,
                text: wmoDesc(code) + (tempC !== null && tempC !== undefined ? (' ' + tempC + '°C') : '')
            });
        }).catch(function (err) { cb(err); });
    }

    // ===== 界面天气：放在最显眼的位置，作为用户决定时间与路线的上下文 =====
    function weatherNote(w) {
        if (!w) return '';
        if (w.extreme === 'hot') return '偏热，路线会自动收紧';
        if (w.extreme === 'cold') return '偏冷，记得添衣';
        if (w.precip === 'rain') return '有雨，偏向室内停靠';
        if (w.precip === 'snow') return '有雪，慢一点走';
        if (w.precip === 'sunny') return '光线正好，适合走街';
        return '云层低，适合漫游';
    }

    function weatherShort(w) {
        if (!w) return '天气读取中';
        if (w.error) return '天气暂不可用';
        var temp = (w.tempC !== null && w.tempC !== undefined) ? (Math.round(w.tempC) + '°') : '';
        return (temp ? temp + ' · ' : '') + wmoDesc(w.code);
    }

    function shortArea(place) {
        if (!place) return userCity || '当前位置';
        if (place.city && /[区县]$/.test(place.city) && place.state && /市$/.test(place.state)) return place.state;
        return place.city || place.district || place.state || place.name || userCity || '当前位置';
    }

    function renderAmbientWeather(state) {
        var loading = state === 'loading';
        var error = state === 'error' || ambientWeatherError;
        var w = ambientWeather;
        if (nowStripEl) {
            nowStripEl.classList.toggle('is-loading', loading);
            nowStripEl.classList.toggle('is-error', !!error && !loading);
        }
        var placeEl = document.getElementById('now-place');
        if (placeEl) placeEl.textContent = '此刻' + (ambientWeatherLabel ? ' · ' + ambientWeatherLabel : '');

        var tempEl = document.getElementById('now-temp');
        var descEl = document.getElementById('now-desc');
        var noteEl = document.getElementById('now-note');
        var planWeather = document.getElementById('plan-weather');
        var planNote = document.getElementById('plan-weather-note');

        if (loading) {
            if (tempEl) tempEl.textContent = '—°';
            if (descEl) descEl.textContent = '读取天气';
            if (noteEl) noteEl.textContent = '正在确认此刻的天气';
            if (planWeather) planWeather.textContent = '—° · 读取中';
            if (planNote) planNote.textContent = '正在读取天气';
            return;
        }
        if (error || !w) {
            if (tempEl) tempEl.textContent = '—°';
            if (descEl) descEl.textContent = '天气暂不可用';
            if (noteEl) noteEl.textContent = '路线仍可生成';
            if (planWeather) planWeather.textContent = '天气暂不可用';
            if (planNote) planNote.textContent = '将按默认偏好生成路线';
            return;
        }
        var temp = (w.tempC !== null && w.tempC !== undefined) ? (Math.round(w.tempC) + '°') : '—°';
        var desc = wmoDesc(w.code);
        var note = weatherNote(w);
        if (tempEl) tempEl.textContent = temp;
        if (descEl) descEl.textContent = desc;
        if (noteEl) noteEl.textContent = note;
        if (planWeather) planWeather.textContent = temp + ' · ' + desc;
        if (planNote) planNote.textContent = note;
    }

    function refreshAmbientWeather(lat, lng, label) {
        if (label) ambientWeatherLabel = label;
        var key = lat.toFixed(2) + ',' + lng.toFixed(2);
        if (key === ambientWeatherKey && ambientWeather) {
            renderAmbientWeather();
            return;
        }
        if (key === ambientWeatherKey && ambientWeatherPendingKey === key) {
            renderAmbientWeather('loading');
            return;
        }
        ambientWeatherKey = key;
        ambientWeatherPendingKey = key;
        ambientWeather = null;
        ambientWeatherError = false;
        renderAmbientWeather('loading');
        fetchWeatherP(lat, lng).then(function (w) {
            if (ambientWeatherPendingKey !== key) return;
            ambientWeatherPendingKey = '';
            ambientWeather = w;
            ambientWeatherError = false;
            renderAmbientWeather();
        }).catch(function (err) {
            if (ambientWeatherPendingKey !== key) return;
            ambientWeatherPendingKey = '';
            ambientWeather = null;
            ambientWeatherError = true;
            console.warn('天气读取失败: ' + err.message);
            renderAmbientWeather('error');
        });
    }
    var ambientWeatherPendingKey = '';

    // 地图弹窗里的收藏按钮：用 id 注册地点，文档级事件代理，
    // 这样弹窗内容被 AI 介绍替换后按钮依然可点。
    var popupFavSeq = 0;
    var popupFavPoints = {};
    function popupFavButtonHtml(p) {
        var id = 'pf' + (++popupFavSeq);
        popupFavPoints[id] = p;
        var auth = window.PianhangAuth;
        var logged = !!(auth && auth.isLoggedIn && auth.isLoggedIn());
        var fav = logged && !!(auth.isFavorite && auth.isFavorite(p));
        return '<button type="button" class="popup-fav' + (fav ? ' is-favorite' : '') +
            '" data-popup-fav="' + id + '"><span class="popup-fav-star" aria-hidden="true">' +
            (fav ? '★' : '☆') + '</span><span class="popup-fav-label">' +
            (fav ? '已收藏' : (logged ? '收藏这个地方' : '登录后收藏')) + '</span></button>';
    }

    document.addEventListener('click', function (event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-popup-fav]') : null;
        if (!btn) return;
        var auth = window.PianhangAuth;
        var point = popupFavPoints[btn.getAttribute('data-popup-fav')];
        if (!auth || !auth.toggleFavorite || !point) return;
        if (!auth.isLoggedIn()) {
            if (auth.openLogin) auth.openLogin();
            return;
        }
        btn.disabled = true;
        auth.toggleFavorite({
            name: point.name || '', type: point.type || '',
            lat: point.lat || 0, lng: point.lng || 0
        }).then(function () {
            var fav = auth.isFavorite(point);
            btn.classList.toggle('is-favorite', fav);
            var star = btn.querySelector('.popup-fav-star');
            if (star) star.textContent = fav ? '★' : '☆';
            var label = btn.querySelector('.popup-fav-label');
            if (label) label.textContent = fav ? '已收藏' : '收藏这个地方';
        }).catch(function (err) {
            console.warn('收藏失败: ' + (err && err.message));
        }).then(function () {
            btn.disabled = false;
        });
    });

    // 绑定地点弹窗：点击Marker时调用后端获取简短介绍(loading→更新)
    var introCache = {};
    function introHtml(text) {
        return '<div style="color:#334155;font-size:11px;margin-top:4px;line-height:1.55">' + escapeHtml(text) + '</div>';
    }
    function bindIntroPopup(marker, displayName, p) {
        var base = '<div style="font-size:14px;line-height:1.5">' +
            '<b style="color:#0f172a">' + escapeHtml(displayName) + '</b><br>' +
            '<span style="color:#64748b">' + escapeHtml(p.type || '地点') + '</span>' +
            popupFavButtonHtml(p) + '</div>';
        var cacheKey = (p.name || displayName || '') + '|' + (p.type || '');
        if (introCache[cacheKey]) {
            marker.bindPopup(base + introHtml(introCache[cacheKey]));
        } else {
            marker.bindPopup(base + '<div style="color:#64748b;font-size:11px;margin-top:4px">正在生成介绍…</div>');
        }
        marker.on('click', function () {
            if (introCache[cacheKey]) {
                marker.setPopupContent(base + introHtml(introCache[cacheKey]));
                return;
            }
            aiPost('/api/get_intro', { name: p.name, type: p.type }).then(function (r) {
                var intro = (r && r.text) ? r.text : '暂无介绍';
                introCache[cacheKey] = intro;
                marker.setPopupContent(base + introHtml(intro));
            }).catch(function () {
                marker.setPopupContent(base);
            });
        });
    }

    // 在地图上绘制POI Marker，点击调用后端获取介绍并弹窗
    function drawMarkers(pois) {
        if (!poiLayer) return;
        poiLayer.clearLayers();
        pois.forEach(function (p) {
            var marker = L.circleMarker(toMapLatLng(p.lat, p.lng), {
                radius: 9,
                color: '#0f172a',
                fillColor: p.color,
                fillOpacity: 0.9,
                weight: 2
            });
            bindIntroPopup(marker, p.name, p);
            marker.addTo(poiLayer);
        });
    }

    // ===== 偏航筛选打分（纯JS业务逻辑，不调用大模型） =====
    // haversine 距离(米)
    function distanceMeters(a, b) {
        var R = 6371000;
        var dLat = (b.lat - a.lat) * Math.PI / 180;
        var dLng = (b.lng - a.lng) * Math.PI / 180;
        var la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    // 规则1：过滤距离过远/超出步行时间/不适合步行的POI(maxR/budget由天气调整)
    function filterFeasiblePOIs(center, pois, maxR, budget) {
        return pois.filter(function (p) {
            if (!p.name || p.name === p.type) return false; // 无具体名称→不适合作为停靠点
            var d = distanceMeters(center, p);
            p._dist = d;
            if (d > maxR) return false;          // 距离过远
            if (d > budget * 0.5) return false;   // 占用过多总预算(粗筛超出步行时间)
            return true;
        });
    }

    // 规则2：综合 距离 + 新奇小众 + 探索偏好 + 路线顺路 打分(0-100)
    // parsedPref: AI解析出的偏好(novelty/minor_level 0-1)，动态调整各维度权重
    function scorePOIs(feasible, maxR, preferences, parsedPref) {
        var total = feasible.length || 1;
        var freq = {}; // 类别频率→新奇度(越稀有越高)
        feasible.forEach(function (p) { freq[p.type] = (freq[p.type] || 0) + 1; });
        var prefVals = Object.keys(preferences).map(function (k) { return preferences[k]; });
        var maxPref = Math.max.apply(null, prefVals) || 1;
        var cx = 0, cy = 0; // 候选质心(顺路参考点)
        feasible.forEach(function (p) { cx += p.lat; cy += p.lng; });
        var centroid = { lat: cx / total, lng: cy / total };
        var maxCd = 1;
        feasible.forEach(function (p) {
            var cd = distanceMeters(p, centroid);
            p._cd = cd;
            if (cd > maxCd) maxCd = cd;
        });
        // 根据 AI 解析出的新奇度/走巷度动态调整打分权重
        var noveltyVal = (parsedPref && typeof parsedPref.novelty === 'number') ? parsedPref.novelty : 0.5;
        var minorVal = (parsedPref && typeof parsedPref.minor_level === 'number') ? parsedPref.minor_level : 0.5;
        var novW = 0.12 + noveltyVal * 0.16;   // 新奇度越高→新奇维度权重越大
        var onwayW = 0.17 + minorVal * 0.12;  // 走巷度越高→顺路维度权重越大
        var prefW = 0.20;
        var distW = Math.max(0.10, 1 - novW - onwayW - prefW); // 其余给距离
        feasible.forEach(function (p) {
            var distScore = 1 - Math.min((p._dist || 0) / maxR, 1);            // 越近越高
            var novScore = 1 - (freq[p.type] / total);                           // 越稀有越新奇
            var prefScore = (preferences[p.type] != null ? preferences[p.type] : 1) / maxPref; // 偏好
            var onwayScore = 1 - Math.min((p._cd || 0) / maxCd, 1);              // 越靠质心越顺路
            p._score = (distScore * distW + novScore * novW + prefScore * prefW + onwayScore * onwayW) * 100;
        });
        feasible.sort(function (a, b) { return (b._score || 0) - (a._score || 0); });
        return feasible;
    }

    // 街道/路口是兜底地点：只有在附近实在找不到真实的店、公园、书店时才用
    function isStreetLike(p) {
        return !!p && (p.type === '街道' || p.type === '路口' || p.type === '街角');
    }

    // 按用户勾选的“想在哪里停一停”优先挑选途经点：
    // 每个选中的类型先占一个位置，再用同类地点补足，最后才用其他真实地点兜底。
    function pickWaypointsByPreference(pool, wanted, count) {
        var byType = {};
        pool.forEach(function (p) {
            if (!p || !p.name) return;
            if (!byType[p.type]) byType[p.type] = [];
            byType[p.type].push(p);
        });
        var picked = [];
        var usedNames = {};
        function take(type, topN) {
            if (picked.length >= count) return false;
            var arr = (byType[type] || []).filter(function (p) { return !usedNames[p.name]; });
            if (!arr.length) return false;
            var slice = arr.slice(0, Math.min(topN || 3, arr.length));
            var p = slice[Math.floor(Math.random() * slice.length)];
            usedNames[p.name] = true;
            picked.push(p);
            return true;
        }

        // 勾选超过 3 类时，优先保留得分最高的前 3 类
        var priority = (wanted || []).slice();
        if (priority.length > count) {
            priority = priority.map(function (t) {
                return { type: t, score: (byType[t] && byType[t][0] && byType[t][0]._score) || 0 };
            }).sort(function (a, b) { return b.score - a.score; })
                .slice(0, count)
                .map(function (x) { return x.type; });
        }

        // 第一轮：每个选中类型各挑一个
        priority.forEach(function (t) { take(t, 3); });
        // 第二轮：在所有选中类型的剩余候选里挑得分最高的，
        // 避免因为勾选顺序而把某一类地点重复塞满、路线来回折返。
        while (picked.length < count && priority.length) {
            var rest = [];
            priority.forEach(function (t) {
                (byType[t] || []).forEach(function (p) {
                    if (!usedNames[p.name]) rest.push(p);
                });
            });
            if (!rest.length) break;
            rest.sort(function (a, b) { return (b._score || 0) - (a._score || 0); });
            var top = rest.slice(0, Math.min(3, rest.length));
            var next = top[Math.floor(Math.random() * top.length)];
            usedNames[next.name] = true;
            picked.push(next);
        }
        // 第三轮：不足时才用其他真实地点补足（不优先使用街道兜底点）
        for (var i = 0; i < pool.length && picked.length < count; i++) {
            var p = pool[i];
            if (!p || !p.name || usedNames[p.name]) continue;
            usedNames[p.name] = true;
            picked.push(p);
        }
        return picked;
    }

    // 规则3：结合天气 + AI偏好 + 出行方式 + 探索节奏 + 地点偏好 → 过滤 → 打分 → 取高分候选池
    // 同一次生成里避免重复的途经点组合
    var usedWaypointSets = {};

    function selectWaypoints(center, pois, minutes, parsedPref, mode, placePrefs) {
        var w = currentWeather || { precip: 'cloudy', extreme: null, text: '未知(默认)' };
        var prefs = buildWeatherPreferences(w.precip, placePrefs || DEFAULT_PREFERENCES);
        var mc = MODE_CONFIG[mode] || MODE_CONFIG.walk;
        var pc = paceConfig();
        // 步行强度影响搜索半径：low=收紧, high=放大
        var intensityFactor = 1.0;
        if (parsedPref && parsedPref.walk_intensity === 'low') intensityFactor = 0.8;
        else if (parsedPref && parsedPref.walk_intensity === 'high') intensityFactor = 1.2;
        var maxR = Math.round(feasibleRadiusFor(minutes, w.extreme) * mc.radiusMul * pc.radiusMul * intensityFactor);
        var budget = mc.speed * minutes * (w.extreme ? WEATHER_DIST_FACTOR : 1) * pc.budgetMul * intensityFactor;
        var feasible = filterFeasiblePOIs(center, pois, maxR, budget);
        var prefLabel = (w.precip === 'rain' || w.precip === 'snow') ? '室内' :
                        (w.precip === 'sunny' ? '户外' : '中性');
        var wLabel = '天气:' + w.text + (w.extreme ? ('[' + (w.extreme === 'hot' ? '极热' : '极冷') + '减距]') : '') +
            ' 偏好:' + prefLabel;
        if (feasible.length === 0) {
            console.warn('偏航筛选(' + wLabel + '): 无可行POI，跳过路线生成');
            return [];
        }
        var scored = scorePOIs(feasible, maxR, prefs, parsedPref);
        // 真实地点优先：附近有店/公园/书店时，完全不用街道名凑数。
        var realPool = scored.filter(function (p) { return !isStreetLike(p); });
        var pool = realPool.length ? realPool : scored;
        var count = Math.min(pc.stops, pool.length);
        if (!count) return [];

        // 只保留确实找到了候选的选中类型；找不到的类型不占位，但仍会记录提示
        var wanted = (selectedPlaceTypes || []).filter(function (t) {
            return pool.some(function (p) { return p.type === t; });
        });
        var missing = (selectedPlaceTypes || []).filter(function (t) {
            return wanted.indexOf(t) < 0;
        });
        if (missing.length) {
            console.warn('附近未找到用户选择的类型：' + missing.join('、') + '，将用其他真实地点补足');
        }

        var picked = null, pickKey = '';
        for (var tryIdx = 0; tryIdx < 12; tryIdx++) {
            picked = pickWaypointsByPreference(pool, wanted, count);
            pickKey = picked.map(function (p) { return p.name; }).sort().join('|');
            if (!usedWaypointSets[pickKey]) break;
        }
        usedWaypointSets[pickKey] = true;
        console.log('偏航筛选(' + wLabel + '): 半径' + maxR + 'm 可行' + feasible.length +
            ' → 真实地点' + realPool.length + ' → 选中' + picked.length +
            ' 个途经点' + (wanted.length ? ('（优先：' + wanted.join('、') + '）') : ''));
        picked.forEach(function (p, i) {
            console.log('  ' + (i + 1) + '. ' + p.name + ' [' + p.type + '] 评分' +
                p._score.toFixed(1) + ' 距' + (p._dist || 0).toFixed(0) + 'm');
        });
        return picked;
    }

    // ===== 步行路线（OSRM公开免费接口） =====

    // OSRM 坐标顺序为 lon,lat，多途经点以 ; 分隔；profile 随出行方式变化；endPoint 为可选终点
    function buildOsmrUrl(startLat, startLng, waypoints, profile, endPoint) {
        var coords = [startLng + ',' + startLat];
        waypoints.forEach(function (p) { coords.push(p.lng + ',' + p.lat); });
        if (endPoint) coords.push(endPoint.lng + ',' + endPoint.lat);
        return 'https://router.project-osrm.org/route/v1/' + (profile || 'walking') + '/' + coords.join(';') +
            '?overview=full&geometries=geojson&steps=false';
    }

    function fetchRoute(startLat, startLng, waypoints, profile, endPoint, cb) {
        var url = buildOsmrUrl(startLat, startLng, waypoints, profile, endPoint);
        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            if (!data.routes || !data.routes.length) throw new Error('无路线');
            cb(null, data.routes[0].geometry, data.routes[0]);
        }).catch(function (err) { cb(err); });
    }


    // ===== AI 路线推荐（调用后端 /api/* 接口） =====
    var lastCandidates = [];
    var lastPref = null;  // 最近一次偏好解析结果，影响打分
    var backendMode = '未知'; // 后端模式：Real(deepseek-chat) 或 Mock(无密钥)

    // 页面初始化时获取后端模式
    function fetchBackendMode() {
        fetch(AI_BASE + '/api/status').then(function (r) { return r.json(); }).then(function (d) {
            backendMode = (d && d.mode) ? d.mode : '未知';
            console.log('后端模式: ' + backendMode);
        }).catch(function (e) {
            console.warn('获取后端模式失败: ' + e.message);
        });
    }
    fetchBackendMode();

    // "其他"自由文本(偏好弹窗中)
    function prefText() {
        var el = document.getElementById('pref-other-input');
        return el ? el.value : '';
    }

    // ===== 偏好设置视图逻辑 =====
    var prefOpenBtn = document.getElementById('pref-open-btn');
    var prefConfirmBtn = document.getElementById('pref-confirm-btn');
    var prefConfirmLabel = document.getElementById('pref-confirm-label');
    var prefErrorEl = document.getElementById('pref-error');
    var prefOtherToggle = document.getElementById('pref-other-toggle');
    var prefOtherInput = document.getElementById('pref-other-input');

    function setPrefBusy(busy) {
        if (!prefConfirmBtn) return;
        prefConfirmBtn.disabled = !!busy;
        prefConfirmBtn.classList.toggle('is-loading', !!busy);
        if (prefConfirmLabel) prefConfirmLabel.textContent = busy ? '正在生成路线…' : '生成偏航路线';
    }

    function clearPrefError() {
        if (prefErrorEl) {
            prefErrorEl.hidden = true;
            prefErrorEl.textContent = '';
        }
        ['start', 'end'].forEach(function (k) {
            var ui = placeUI[k];
            if (!ui) return;
            if (ui.field) ui.field.classList.remove('is-missing');
            if (ui.input) ui.input.setAttribute('aria-invalid', 'false');
        });
    }

    function showPrefError(message, missing) {
        if (prefErrorEl) {
            prefErrorEl.textContent = message;
            prefErrorEl.hidden = false;
        }
        (missing || []).forEach(function (k) {
            var ui = placeUI[k];
            if (!ui) return;
            if (ui.field) ui.field.classList.add('is-missing');
            if (ui.input) ui.input.setAttribute('aria-invalid', 'true');
        });
        if (prefErrorEl && prefErrorEl.scrollIntoView) {
            prefErrorEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // 路线加载进度：真实阶段推进 + 慢速爬行，避免等待时进度条停住
    var routesProgressTimer = null;
    var routesProgressValue = 0;

    function routesProgressEls() {
        return {
            wrap: document.querySelector('.routes-progress'),
            fill: document.getElementById('routes-progress-fill'),
            sub: document.getElementById('routes-loading-sub')
        };
    }

    function setRoutesProgress(pct, text) {
        var els = routesProgressEls();
        if (!els.fill) return;
        routesProgressValue = Math.max(routesProgressValue, Math.min(100, Math.round(pct)));
        els.fill.style.width = routesProgressValue + '%';
        if (els.wrap) els.wrap.setAttribute('aria-valuenow', String(routesProgressValue));
        if (text && els.sub) els.sub.textContent = text;
    }

    function startRoutesProgress() {
        routesProgressValue = 0;
        setRoutesProgress(6, '正在解析你的偏好，读取此刻天气…');
        if (routesProgressTimer) clearInterval(routesProgressTimer);
        routesProgressTimer = setInterval(function () {
            if (routesProgressValue >= 90) return;
            setRoutesProgress(routesProgressValue + (routesProgressValue < 50 ? 2.2 : 0.9));
        }, 600);
    }

    function finishRoutesProgress() {
        if (routesProgressTimer) { clearInterval(routesProgressTimer); routesProgressTimer = null; }
        setRoutesProgress(100, '三条岔路准备好了');
    }

    function stopRoutesProgress() {
        if (routesProgressTimer) { clearInterval(routesProgressTimer); routesProgressTimer = null; }
    }

    function renderRoutesLoading() {
        return '<div class="routes-loading">' +
            '<div class="routes-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
            '<span class="routes-progress-fill" id="routes-progress-fill"></span></div>' +
            '<p class="routes-loading-title">正在寻找可以偏航的路口</p>' +
            '<p class="routes-loading-sub" id="routes-loading-sub">正在解析你的偏好，读取此刻天气…</p>' +
            '</div>';
    }

    // "重新偏航" → 回到开始屏，重置全部状态
    function resetToStart() {
        // 隐藏所有非开始视图
        if (viewExplore) viewExplore.hidden = true;
        if (viewPref) viewPref.hidden = true;
        if (viewDest) viewDest.hidden = true;
        var vr = document.getElementById('view-routes');
        if (vr) vr.hidden = true;
        // 退出导航 / 选点模式
        document.body.classList.remove('nav-mode');
        resetPickState();
        var bar = document.getElementById('nav-bar');
        if (bar) bar.hidden = true;
        // 清理地图图层
        if (routeLayer) routeLayer.clearLayers();
        if (poiLayer && map) map.removeLayer(poiLayer);
        // 重置状态
        selectedMinutes = null;
        hasDestination = false;
        startCoords = null;
        endCoords = null;
        startPlace = null;
        endPlace = null;
        lastCandidates = null;
        lastPref = null;
        currentWeather = null;
        enteredExplore = false;
        clearPrefError();
        setPrefBusy(false);
        // 重置UI
        timePresets.forEach(function (el) { el.classList.remove('active'); });
        if (timePickBtn) timePickBtn.classList.remove('active');
        resetTimePickLabel();
        if (timeChosenEl) timeChosenEl.hidden = true;
        if (prefOtherToggle) prefOtherToggle.classList.remove('active');
        if (prefOtherInput) { prefOtherInput.value = ''; prefOtherInput.hidden = true; }
        applySavedPreferences();
        // 重置起终点搜索与选点显示
        updatePlaceField('start', null);
        updatePlaceField('end', null);
        if (startNameEl) { startNameEl.hidden = true; startNameEl.textContent = ''; }
        if (endNameEl) { endNameEl.hidden = true; endNameEl.textContent = ''; }
        if (startResetBtn) startResetBtn.hidden = true;
        var rb = document.getElementById('route-block');
        if (rb) rb.hidden = true;
        // 恢复当前地点的天气上下文
        if (userLocation) refreshAmbientWeather(userLocation.lat, userLocation.lng, userCity || '当前位置');
        else if (map) {
            var center = gcj02ToWgs84(map.getCenter().lat, map.getCenter().lng);
            refreshAmbientWeather(center.lat, center.lng, userCity || '当前位置');
        }
        // 显示开始屏
        if (viewStart) { viewStart.hidden = false; revealView(viewStart); }
        setFlowStep(1);
        updateStartButton();
        console.log('已重置到开始界面');
    }

    // 出行方式：单选
    var prefModeBtns = document.querySelectorAll('.pref-mode');
    prefModeBtns.forEach(function (b) {
        b.addEventListener('click', function () {
            prefModeBtns.forEach(function (x) { x.classList.remove('active'); });
            b.classList.add('active');
            selectedMode = b.dataset.mode;
            prefSelectionTouched = true;
            renderPrefSummary();
        });
    });

    // 地点偏好：多选(其他按钮切换输入框)
    var prefTagBtns = document.querySelectorAll('.pref-tag:not(.pref-tag-other)');
    prefTagBtns.forEach(function (b) {
        b.addEventListener('click', function () {
            b.classList.toggle('active');
            var t = b.dataset.type;
            var i = selectedPlaceTypes.indexOf(t);
            if (i >= 0) selectedPlaceTypes.splice(i, 1);
            else selectedPlaceTypes.push(t);
            prefSelectionTouched = true;
            renderPrefSummary();
        });
    });
    if (prefOtherToggle) {
        prefOtherToggle.addEventListener('click', function () {
            var on = prefOtherToggle.classList.toggle('active');
            if (prefOtherInput) prefOtherInput.hidden = !on;
        });
    }

    // 把偏好设置里的默认值带入本次流程
    function applySavedPreferences() {
        var prefs = window.PianhangPrefs ? window.PianhangPrefs.get() : null;
        if (!prefs) return;
        prefPace = prefs.pace;
        selectedMode = prefs.default_mode;
        selectedPlaceTypes = prefs.interests.slice();
        prefSelectionTouched = false;
        prefModeBtns.forEach(function (b) {
            b.classList.toggle('active', b.dataset.mode === selectedMode);
        });
        prefTagBtns.forEach(function (b) {
            b.classList.toggle('active', selectedPlaceTypes.indexOf(b.dataset.type) >= 0);
        });
        renderPrefSummary();
    }

    function renderPrefSummary() {
        var textEl = document.getElementById('pref-summary-text');
        if (!textEl) return;
        var mode = MODE_CONFIG[selectedMode] || MODE_CONFIG.walk;
        var pace = paceConfig();
        var interests = selectedPlaceTypes.length
            ? selectedPlaceTypes.join(' / ')
            : '不限定停留类型';
        textEl.textContent = '本次：' + mode.label + ' · ' + pace.label + ' · ' + interests;
    }

    window.addEventListener('pianhang:prefs', function (event) {
        var prefs = (event && event.detail) || (window.PianhangPrefs ? window.PianhangPrefs.get() : null);
        if (!prefs) return;
        prefPace = prefs.pace;
        // 开始屏或还没手动改过预选时更新；已经调整过就只影响下一次重新偏航
        var atPristinePref = viewPref && !viewPref.hidden && !prefSelectionTouched;
        if ((viewStart && !viewStart.hidden) || atPristinePref) applySavedPreferences();
        else renderPrefSummary();
    });

    applySavedPreferences();

    // "重新偏航"按钮 → 回到开始屏
    if (prefOpenBtn) prefOpenBtn.addEventListener('click', resetToStart);
    // "生成偏航路线" → 进入探索屏 + 生成路线
    if (prefConfirmBtn) prefConfirmBtn.addEventListener('click', enterExploreFromPref);

    // ===== 起点终点：默认定位 + 地图选点 =====
    var startPickBtn = document.getElementById('start-pick-btn');
    var endPickBtn = document.getElementById('end-pick-btn');
    var startDetailEl = document.getElementById('start-detail');
    var endDetailEl = document.getElementById('end-detail');
    var startStateEl = document.getElementById('start-state');
    var endStateEl = document.getElementById('end-state');
    var startNameEl = document.getElementById('start-name');
    var endNameEl = document.getElementById('end-name');
    var startResetBtn = document.getElementById('start-reset-btn');
    var pickUIEl = document.getElementById('pick-ui');
    var pickTitleEl = document.getElementById('pick-title');
    var pickCloseBtn = document.getElementById('pick-close');
    var pickEmptyEl = document.getElementById('pick-empty');
    var pickResultEl = document.getElementById('pick-result');
    var pickResultNameEl = document.getElementById('pick-result-name');
    var pickResultAddrEl = document.getElementById('pick-result-addr');
    var pickConfirmBtn = document.getElementById('pick-confirm');
    var pickHintEl = document.querySelector('.pick-hint');

    var placeUI = {
        start: {
            which: 'start', field: document.getElementById('start-block'),
            meta: startDetailEl, state: startStateEl, name: startNameEl,
            reset: startResetBtn, pick: startPickBtn
        },
        end: {
            which: 'end', field: document.getElementById('route-block'),
            meta: endDetailEl, state: endStateEl, name: endNameEl,
            reset: null, pick: endPickBtn
        }
    };

    var pickingWhich = null; // 'start' | 'end' | null 地图选点目标
    var pickMarker = null;   // 选点临时标记
    var pickState = { which: null, place: null, coords: null, token: 0 };

    function normalizePlace(place) {
        if (!place) return null;
        var lat = Number(place.lat), lng = Number(place.lng);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        return {
            name: String(place.name || '未命名地点'),
            address: String(place.address || ''),
            kind: String(place.kind || '地点'),
            lat: lat, lng: lng,
            city: place.city || '', district: place.district || '', state: place.state || '',
            osmKey: place.osmKey || '', osmValue: place.osmValue || '',
            featureType: place.featureType || ''
        };
    }

    function placeMetaText(place) {
        if (!place) return '';
        var parts = [];
        if (place.kind) parts.push(place.kind);
        if (place.address) parts.push(place.address);
        return parts.length ? parts.join(' · ') : '已选择地点';
    }

    function updateUserPlaceDefaults() {
        if (startPlace) return;
        if (startDetailEl) startDetailEl.textContent = '当前位置' + (userCity ? ' · ' + userCity : ' · 自动定位');
        if (startStateEl) startStateEl.textContent = '默认当前位置';
        if (startNameEl) { startNameEl.hidden = true; startNameEl.textContent = ''; }
        if (startResetBtn) startResetBtn.hidden = true;
        if (placeUI.start.field) placeUI.start.field.classList.remove('has-place');
    }

    function updatePlaceField(which, place, opts) {
        opts = opts || {};
        var ui = placeUI[which];
        if (!ui || !ui.field) return;
        ui.field.classList.toggle('has-place', !!place);
        if (ui.state) ui.state.textContent = place ? '已选择' : (which === 'start' ? '默认当前位置' : '尚未选择');
        if (ui.name) {
            ui.name.hidden = !place;
            ui.name.textContent = place ? place.name : '';
        }
        if (place) {
            if (ui.meta) {
                ui.meta.textContent = placeMetaText(place);
                ui.meta.classList.add('is-selected');
            }
            if (ui.reset) ui.reset.hidden = false;
            ui.field.classList.remove('is-missing');
        } else {
            if (ui.meta) {
                ui.meta.classList.remove('is-selected');
                ui.meta.textContent = which === 'start'
                    ? ('当前位置' + (userCity ? ' · ' + userCity : ' · 自动定位'))
                    : '终点决定偏航的方向';
            }
            if (ui.reset) ui.reset.hidden = true;
        }
    }

    function clearPlace(which, opts) {
        opts = opts || {};
        if (which === 'start') {
            startPlace = null;
            startCoords = null;
        } else {
            endPlace = null;
            endCoords = null;
        }
        updatePlaceField(which, null, opts);
        if (!opts.silent) {
            clearPrefError();
            if (which === 'start') {
                if (userLocation) refreshAmbientWeather(userLocation.lat, userLocation.lng, userCity || '当前位置');
                else renderAmbientWeather('error');
            }
        }
    }

    function setPlace(which, place, opts) {
        opts = opts || {};
        var p = normalizePlace(place);
        if (!p) return;
        var isStart = which === 'start';
        if (isStart) {
            startPlace = p;
            startCoords = { lat: p.lat, lng: p.lng };
        } else {
            endPlace = p;
            endCoords = { lat: p.lat, lng: p.lng };
        }
        updatePlaceField(which, p);
        clearPrefError();
        if (map) map.setView(toMapLatLng(p.lat, p.lng), Math.max(map.getZoom(), 15));
        if (isStart) refreshAmbientWeather(p.lat, p.lng, shortArea(p));
        console.log((isStart ? '起点' : '终点') + '已选择: ' + p.name + (p.address ? (' / ' + p.address) : '') +
            ' [' + p.lat.toFixed(4) + ',' + p.lng.toFixed(4) + ']');
    }

    // ===== Photon 反向地理编码（WGS-84） =====
    function fetchWithTimeout(url, ms, externalSignal) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, ms);
        if (externalSignal) {
            if (externalSignal.aborted) controller.abort();
            else externalSignal.addEventListener('abort', function () { controller.abort(); });
        }
        return fetch(url, { signal: controller.signal }).then(function (r) {
            clearTimeout(timer);
            return r;
        }, function (err) {
            clearTimeout(timer);
            throw err;
        });
    }

    function photonReverseUrl(lat, lng) {
        return 'https://photon.komoot.io/reverse?lon=' + Number(lng).toFixed(6) +
            '&lat=' + Number(lat).toFixed(6) + '&limit=8';
    }

    // ===== 高德逆地理编码（后端代理，国内直连、无需 key） =====
    // 数据坐标为 GCJ-02：请求前先把 WGS-84 转过去，返回后再转回来。
    function amapRegeo(lat, lng, ms) {
        var g = wgs84ToGcj02(lat, lng);
        var url = AI_BASE + '/api/amap/regeo?lat=' + g.lat.toFixed(6) + '&lng=' + g.lng.toFixed(6);
        return fetchWithTimeout(url, ms || 8000).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            if (!data || data.ok === false) throw new Error((data && data.error) || '高德不可用');
            return data;
        });
    }

    // pos 示例："在大连理工大学汽车实验室附近, 在弘远北路旁边, 靠近..."
    function amapLandmarkName(data) {
        var pos = (data && data.pos) || '';
        var m = pos.match(/^在(.+?)附近/);
        if (m && m[1] && m[1].length <= 24 && m[1].indexOf('路') < 0) return m[1];
        return '';
    }

    function amapAddress(data) {
        var parts = [];
        ['district', 'city', 'province'].forEach(function (k) {
            var s = String((data && data[k]) || '').trim();
            if (s && parts.indexOf(s) < 0) parts.push(s);
        });
        return parts.join(' · ') || (data && data.desc) || '';
    }

    // 高德返回的道路/路口 → 地图选点名称：附近地标 → 路口 → 道路
    function amapReversePlace(data, clicked) {
        var roads = (data && data.roads) || [];
        var crosses = (data && data.crosses) || [];
        if (!roads.length && !crosses.length && !amapLandmarkName(data)) return null;
        var gcjClicked = wgs84ToGcj02(clicked.lat, clicked.lng);
        function near(list) {
            var best = null, bestD = Infinity;
            list.forEach(function (p) {
                var d = distanceMeters(gcjClicked, { lat: p.lat, lng: p.lng });
                if (d < bestD) { bestD = d; best = p; }
            });
            return best ? { p: best, d: bestD } : null;
        }
        var cross = near(crosses);
        var road = near(roads);
        var landmark = amapLandmarkName(data);
        var name = '', kind = '';
        if (landmark) {
            name = landmark; kind = '地点';
        } else if (cross && cross.d <= 260) {
            name = cross.p.name.replace(/--/g, ' · '); kind = '路口';
        } else if (road) {
            name = road.p.name; kind = '道路';
        } else if (cross) {
            name = cross.p.name.replace(/--/g, ' · '); kind = '路口';
        }
        if (!name) return null;
        return {
            name: name,
            address: amapAddress(data),
            kind: kind,
            lat: clicked.lat, lng: clicked.lng,
            city: (data && data.city) || '', district: (data && data.district) || '',
            state: (data && data.province) || ''
        };
    }

    function photonTypeLabel(p) {
        var key = p.osm_key || '', value = p.osm_value || '';
        if (key === 'highway') return value === 'bus_stop' ? '公交站' : '道路';
        if (key === 'building') return '建筑';
        if (key === 'tourism') return '景点';
        if (key === 'historic') return '历史建筑';
        if (key === 'shop') return '店铺';
        if (key === 'leisure') return '休闲';
        if (key === 'place') return '区域';
        if (key === 'railway') return '车站';
        if (key === 'natural') return '自然';
        if (key === 'amenity') {
            var map = { cafe: '咖啡店', restaurant: '餐厅', bookstore: '书店', library: '图书馆',
                museum: '博物馆', marketplace: '市场', university: '校园', place_of_worship: '场所' };
            return map[value] || '地点';
        }
        return '地点';
    }

    function uniqueParts(parts) {
        var out = [], seen = {};
        parts.forEach(function (p) {
            var s = String(p || '').trim();
            if (!s || seen[s]) return;
            seen[s] = true;
            out.push(s);
        });
        return out;
    }

    function formatPlaceAddress(p, name) {
        var parts = [];
        if (p.street) {
            var line = p.street + (p.housenumber ? (p.housenumber + '号') : '');
            if (line !== name) parts.push(line);
        }
        if (p.locality && p.locality !== name) parts.push(p.locality);
        if (p.district && p.district !== name) parts.push(p.district);
        if (p.city && p.city !== name && p.city !== p.district) parts.push(p.city);
        if (p.state && p.state !== name && p.state !== p.city) parts.push(p.state);
        if (!parts.length && p.country) parts.push(p.country);
        return uniqueParts(parts).join(' · ');
    }

    function photonFeatureToPlace(feature, overrideCoords) {
        if (!feature) return null;
        var p = feature.properties || {};
        var coords = feature.geometry && feature.geometry.coordinates;
        if (!coords && !overrideCoords) return null;
        var featureLat = coords ? Number(coords[1]) : overrideCoords.lat;
        var featureLng = coords ? Number(coords[0]) : overrideCoords.lng;
        var lat = overrideCoords ? overrideCoords.lat : featureLat;
        var lng = overrideCoords ? overrideCoords.lng : featureLng;
        if (!isFinite(lat) || !isFinite(lng)) return null;
        var name = p.name || p.street || p.district || p.city || p.state;
        if (!name) return null;
        return {
            name: String(name),
            address: formatPlaceAddress(p, name),
            kind: photonTypeLabel(p),
            lat: lat, lng: lng,
            city: p.city || '', district: p.district || '', state: p.state || '',
            osmKey: p.osm_key || '', osmValue: p.osm_value || '', featureType: p.type || '',
            _dist: distanceMeters({ lat: lat, lng: lng }, { lat: featureLat, lng: featureLng })
        };
    }

    var GENERIC_OSM_VALUES = {
        post_box: 1, toilets: 1, atm: 1, parking: 1, bicycle_parking: 1,
        bench: 1, waste_basket: 1, drinking_water: 1, charging_station: 1,
        vending_machine: 1, bus_stop: 1, traffic_signals: 1, crossing: 1,
        shelter: 1, fountain: 1, clock: 1
    };
    var LANDMARK_KEYS = {
        building: 1, tourism: 1, historic: 1, leisure: 1, place: 1, natural: 1, railway: 1
    };

    function isStreetPlace(p) {
        return p.osmKey === 'highway' && p.featureType === 'street';
    }

    function isLandmarkPlace(p) {
        return !!LANDMARK_KEYS[p.osmKey] && !GENERIC_OSM_VALUES[p.osmValue];
    }

    function byDistance(a, b) {
        return (a._dist || 0) - (b._dist || 0);
    }

    function withClickedCoords(place, clicked) {
        var p = {};
        Object.keys(place).forEach(function (k) { p[k] = place[k]; });
        p.lat = clicked.lat;
        p.lng = clicked.lng;
        return p;
    }

    function streetFallback(features, clicked) {
        var prop = null;
        for (var i = 0; i < (features || []).length; i++) {
            var pp = features[i].properties || {};
            if (pp.street) { prop = pp; break; }
        }
        if (!prop) return null;
        var parts = uniqueParts([prop.district, prop.city, prop.state]);
        return {
            name: prop.street,
            address: parts.join(' · '),
            kind: '道路',
            lat: clicked.lat, lng: clicked.lng,
            city: prop.city || '', district: prop.district || '', state: prop.state || ''
        };
    }

    // 地图点选后的命名规则：附近的地标 → 附近街道 → 附近有名字的地点 → 街道兜底
    function chooseReversePlace(features, clicked) {
        var places = (features || []).map(function (f) {
            return photonFeatureToPlace(f, clicked);
        }).filter(Boolean);
        var named = places.filter(function (p) { return p.name && !GENERIC_OSM_VALUES[p.osmValue]; });

        var landmark = named.filter(function (p) {
            return isLandmarkPlace(p) && p._dist <= 180;
        }).sort(byDistance)[0];
        if (landmark) return withClickedCoords(landmark, clicked);

        var street = named.filter(function (p) {
            return isStreetPlace(p) && p._dist <= 180;
        }).sort(byDistance)[0];
        if (street) return withClickedCoords(street, clicked);

        var nearby = named.filter(function (p) {
            return p._dist <= 110;
        }).sort(byDistance)[0];
        if (nearby) return withClickedCoords(nearby, clicked);

        var streetProp = streetFallback(features, clicked);
        if (streetProp) return streetProp;

        var farStreet = named.filter(isStreetPlace).sort(byDistance)[0];
        if (farStreet) return withClickedCoords(farStreet, clicked);

        return {
            name: '地图上的位置',
            address: '附近暂无命名地点',
            kind: '位置',
            lat: clicked.lat, lng: clicked.lng,
            city: '', district: '', state: ''
        };
    }

    // ===== 地图选点全屏浮层 =====
    function cleanupPickMarker() {
        if (pickMarker && map) { map.removeLayer(pickMarker); pickMarker = null; }
    }

    function resetPickState() {
        pickState.token++;
        pickState.which = null;
        pickState.place = null;
        pickState.coords = null;
        pickingWhich = null;
        cleanupPickMarker();
        document.body.classList.remove('pick-mode');
        if (pickUIEl) pickUIEl.hidden = true;
        if (pickResultEl) { pickResultEl.hidden = true; pickResultEl.classList.remove('is-loading'); }
        if (pickEmptyEl) pickEmptyEl.hidden = false;
        if (pickConfirmBtn) pickConfirmBtn.disabled = true;
    }

    function closePickMode() {
        var restore = !!pickingWhich;
        resetPickState();
        if (!restore) return;
        if (prefSection) prefSection.hidden = false;
        if (viewExplore) viewExplore.hidden = true;
        if (viewPref) { viewPref.hidden = false; revealView(viewPref); }
        setFlowStep(3);
        setTimeout(function () { if (map) map.invalidateSize(); }, 220);
    }

    function placePickMarker(lat, lng) {
        if (!map) return;
        cleanupPickMarker();
        var icon = L.divIcon({
            className: 'pick-marker',
            html: '<div class="pick-pin"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        pickMarker = L.marker(toMapLatLng(lat, lng), { icon: icon, interactive: false, keyboard: false, zIndexOffset: 1200 }).addTo(map);
    }

    function renderPickPending(place, loading) {
        if (!pickEmptyEl || !pickResultEl) return;
        pickEmptyEl.hidden = true;
        pickResultEl.hidden = false;
        pickResultEl.classList.toggle('is-loading', !!loading);
        if (loading) {
            if (pickResultNameEl) pickResultNameEl.textContent = '正在识别附近地点…';
            if (pickResultAddrEl) pickResultAddrEl.textContent = '正在读取街道与建筑名称';
            if (pickConfirmBtn) pickConfirmBtn.disabled = true;
            if (pickHintEl) pickHintEl.textContent = '正在识别这个位置';
            return;
        }
        if (pickResultNameEl) pickResultNameEl.textContent = place ? place.name : '地图上的位置';
        if (pickResultAddrEl) pickResultAddrEl.textContent = place ? placeMetaText(place) : '附近暂无命名地点';
        if (pickConfirmBtn) pickConfirmBtn.disabled = !place;
        if (pickHintEl) pickHintEl.textContent = '可以继续点击地图重新选点';
    }

    function setPickCandidate(place) {
        var p = normalizePlace(place);
        if (!p) return;
        pickState.token++;
        pickState.place = p;
        pickState.coords = { lat: p.lat, lng: p.lng };
        placePickMarker(p.lat, p.lng);
        if (map) map.setView(toMapLatLng(p.lat, p.lng), Math.max(map.getZoom(), 16));
        renderPickPending(p, false);
    }

    function handleMapPick(e) {
        if (!pickingWhich) return;
        var w = gcj02ToWgs84(e.latlng.lat, e.latlng.lng);
        var clicked = { lat: w.lat, lng: w.lng };
        var token = ++pickState.token;
        pickState.place = null;
        pickState.coords = clicked;
        placePickMarker(clicked.lat, clicked.lng);
        renderPickPending(null, true);
        // 优先使用国内高德逆地理编码；失败时再用 Photon 兜底
        amapRegeo(clicked.lat, clicked.lng, 6000).then(function (data) {
            if (token !== pickState.token) return;
            var place = amapReversePlace(data, clicked);
            if (!place) throw new Error('高德未返回可用名称');
            pickState.place = normalizePlace(place);
            renderPickPending(pickState.place, false);
        }).catch(function (err) {
            if (token !== pickState.token) return;
            console.warn('高德反向解析失败（' + err.message + '），尝试 Photon');
            return fetchWithTimeout(photonReverseUrl(clicked.lat, clicked.lng), 5000).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (data) {
                if (token !== pickState.token) return;
                var place = chooseReversePlace((data && data.features) || [], clicked);
                pickState.place = normalizePlace(place);
                renderPickPending(pickState.place, false);
            }).catch(function (err2) {
                if (token !== pickState.token) return;
                console.warn('反向地理编码失败: ' + err2.message);
                pickState.place = {
                    name: '地图上的位置', address: '附近暂无命名地点', kind: '位置',
                    lat: clicked.lat, lng: clicked.lng, city: '', district: '', state: ''
                };
                renderPickPending(pickState.place, false);
            });
        });
    }

    function startPickPoint(which) {
        if (pickingWhich) return;
        pickingWhich = which;
        pickState.which = which;
        pickState.place = null;
        pickState.coords = null;
        pickState.token++;
        cleanupPickMarker();
        if (pickTitleEl) pickTitleEl.textContent = which === 'start' ? '选择起点' : '选择终点';
        if (pickEmptyEl) pickEmptyEl.hidden = false;
        if (pickResultEl) { pickResultEl.hidden = true; pickResultEl.classList.remove('is-loading'); }
        if (pickConfirmBtn) pickConfirmBtn.disabled = true;
        if (pickHintEl) pickHintEl.textContent = '拖动地图调整范围 · 点击地图重新选点';
        if (prefSection) prefSection.hidden = true;
        if (viewPref) viewPref.hidden = true;
        if (viewExplore) { viewExplore.hidden = false; revealView(viewExplore); }
        if (pickUIEl) pickUIEl.hidden = false;
        document.body.classList.add('pick-mode');
        if (map) {
            var target = which === 'start'
                ? (startCoords || userLocation)
                : (endCoords || startCoords || userLocation);
            setTimeout(function () {
                if (!map) return;
                map.invalidateSize();
                if (target) map.setView(toMapLatLng(target.lat, target.lng), 16);
            }, 240);
        }
    }

    updatePlaceField('start', null);
    updatePlaceField('end', null);

    if (startPickBtn) startPickBtn.addEventListener('click', function () { startPickPoint('start'); });
    if (endPickBtn) endPickBtn.addEventListener('click', function () { startPickPoint('end'); });
    if (startResetBtn) {
        startResetBtn.addEventListener('click', function () {
            clearPlace('start');
            startResetBtn.blur();
        });
    }
    if (pickCloseBtn) pickCloseBtn.addEventListener('click', closePickMode);
    if (pickConfirmBtn) {
        pickConfirmBtn.addEventListener('click', function () {
            if (!pickState.place || !pickState.which) return;
            var which = pickState.which;
            var place = pickState.place;
            setPlace(which, place, { fromMap: true });
            closePickMode();
        });
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && pickingWhich) closePickMode();
    });

    // 地图点击回调（打印WGS-84经纬度 + 地图选点）
    if (map) map.on('click', function (e) {
        var w = gcj02ToWgs84(e.latlng.lat, e.latlng.lng);
        console.log('地图点击点经纬度(WGS-84):', { lat: w.lat, lng: w.lng });
        handleMapPick(e);
    });

    function aiPost(path, payload) {
        return fetch(AI_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) {
            if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
            return r.json();
        });
    }

    // 把回调式接口包成 Promise，便于串行/并发
    function fetchWeatherP(lat, lng) {
        return new Promise(function (res, rej) { fetchWeather(lat, lng, function (e, d) { e ? rej(e) : res(d); }); });
    }
    function fetchPOIsP(lat, lng, radius) {
        return new Promise(function (res, rej) {
            fetchPOIs(lat, lng, radius, function (e, pois) { e ? rej(e) : res(pois); });
        });
    }
    function fetchRouteP(startLat, startLng, wp, profile, endPoint) {
        return new Promise(function (res, rej) {
            fetchRoute(startLat, startLng, wp, profile, endPoint, function (e, geometry, route) { e ? rej(e) : res({ geometry: geometry, route: route }); });
        });
    }

    // 贪心排序途经点：从起点出发，每步选最近的未访问点，减少同路折返
    function greedyOrder(startPoint, waypoints, endPoint) {
        if (!waypoints || waypoints.length <= 1) return waypoints || [];
        var remaining = waypoints.slice();
        var ordered = [];
        var cur = startPoint;
        while (remaining.length) {
            var bestIdx = 0, bestD = Infinity;
            for (var i = 0; i < remaining.length; i++) {
                var d = distanceMeters(cur, remaining[i]);
                if (d < bestD) { bestD = d; bestIdx = i; }
            }
            ordered.push(remaining[bestIdx]);
            cur = remaining[bestIdx];
            remaining.splice(bestIdx, 1);
        }
        return ordered;
    }

    // 构建单条候选：途经点(贪心排序) + OSRM路线 + 后端理由
    function buildCandidate(center, waypoints, wText, minutes, mode, startPoint, endPoint, maxDistance) {
        var profile = (MODE_CONFIG[mode] || MODE_CONFIG.walk).profile;
        var start = startPoint || center;
        // 先贪心排序途经点，让路线逐步推进而非折返
        var orderedWp = greedyOrder(start, waypoints, endPoint);
        return fetchRouteP(start.lat, start.lng, orderedWp, profile, endPoint).then(function (route) {
            var legs = (route && route.route && route.route.legs) || [];
            var dist = (route && route.route && route.route.distance) || 0;
            console.log('候选路线 ' + Math.round(dist) + 'm: ' +
                orderedWp.map(function (p) { return p.name; }).join(' → ') +
                ' | 分段 ' + legs.map(function (l) { return Math.round(l.distance); }).join('/'));
            // 明显超出时间预算的候选先不请求 AI 理由，交给上层换途经点重试
            if (maxDistance && dist > maxDistance) {
                return { waypoints: orderedWp, route: route, reason: '', distance: dist,
                    startPoint: start, endPoint: endPoint || null, tooLong: true,
                    approx: orderedWp.some(function (p) { return p.approx; }) };
            }
            return aiPost('/api/get_reason', {
                pois: orderedWp.map(function (p) { return { name: p.name, type: p.type }; }),
                weather: wText, minutes: minutes
            }).then(function (r) {
                return { waypoints: orderedWp, route: route, reason: (r && r.text) || '',
                    distance: (route && route.route && route.route.distance) || 0,
                    startPoint: start, endPoint: endPoint || null,
                    approx: orderedWp.some(function (p) { return p.approx; }) };
            });
        }).catch(function (err) {
            return { waypoints: orderedWp, route: null, reason: '（路线获取失败：' + err.message + '）', distance: 0,
                startPoint: start, endPoint: endPoint || null, error: err.message,
                approx: orderedWp.some(function (p) { return p.approx; }) };
        });
    }

    // "重新偏航"：偏好解析(先) → [有目的地需已选起终点] → 天气 → POI → 3条候选路线 → 弹窗
    var locationGateUsed = false;

    function loadCandidates() {
        if (selectedMinutes === null || !map) return;
        // 起点默认当前位置：进入偏好页时定位可能还没返回，先等最多 4 秒
        if (!startCoords && !startPlace && !locationGateUsed) {
            locationGateUsed = true;
            setPrefBusy(true);
            ensureUserLocation(4000).then(function () {
                if (!startCoords) startCoords = userLocation || mapCenterWgs();
                locationGateUsed = false;
                loadCandidates();
            }).catch(function (err) {
                console.warn('等待定位失败: ' + (err && err.message));
                if (!startCoords) startCoords = userLocation || mapCenterWgs();
                locationGateUsed = false;
                loadCandidates();
            });
            return;
        }
        var mc = MODE_CONFIG[selectedMode] || MODE_CONFIG.walk;
        setPrefBusy(true);
        clearPrefError();

        // 起点未手动选择时，默认用定位位置（定位失败则用地图中心）
        if (!startCoords) startCoords = userLocation || mapCenterWgs();

        // 有目的地：终点必须手动选；起点已有默认值
        if (hasDestination) {
            if (!endCoords) {
                setPrefBusy(false);
                showPrefError('先在地图上选择一个终点。', ['end']);
                var vr = document.getElementById('view-routes');
                if (vr) vr.hidden = true;
                if (viewPref) { viewPref.hidden = false; revealView(viewPref); }
                setFlowStep(3);
                return;
            }
        }

        // 搜索中心：有目的地取起终点中点，否则起点/用户位置
        var center;
        if (hasDestination && startCoords && endCoords) {
            center = { lat: (startCoords.lat + endCoords.lat) / 2, lng: (startCoords.lng + endCoords.lng) / 2 };
        } else if (startCoords) {
            center = startCoords;
        } else if (userLocation) {
            center = userLocation;
        } else {
            // 兜底：地图中心是GCJ-02，转回WGS-84供数据请求使用
            center = mapCenterWgs();
        }
        var pc = paceConfig();
        var radius = Math.round(radiusByMin(selectedMinutes) * mc.radiusMul * pc.radiusMul);
        if (hasDestination && startCoords && endCoords) {
            var seDist = distanceMeters(startCoords, endCoords);
            radius = Math.max(radius, Math.round(seDist * 0.45));
        }
        console.log('开始生成候选路线: 中心(' + center.lat.toFixed(4) + ',' + center.lng.toFixed(4) + ') 半径' + radius + 'm 方式:' + mc.label +
            (hasDestination ? ' 有目的地' : ''));

        // 1. 先解析偏好(若有自由文本)，用于影响打分；后端不可用时回退默认
        aiPost('/api/parse_pref', { user_text: prefText(), minutes: selectedMinutes })
            .then(function (pref) { lastPref = pref; console.log('偏好解析: ' + JSON.stringify(pref)); setRoutesProgress(24, '正在读取此刻的天气…'); })
            .catch(function (err) { console.warn('偏好解析失败，使用默认: ' + err.message); lastPref = null; })
            .then(function () {
                // 2. 天气：失败时退化为默认天气，不阻断路线生成
                return fetchWeatherP(center.lat, center.lng).catch(function (err) {
                    console.warn('天气读取失败，按默认天气生成: ' + err.message);
                    return { code: null, tempC: null, precip: 'cloudy', extreme: null, text: '天气暂不可用', error: true };
                });
            }).then(function (weather) {
                currentWeather = weather;
                ambientWeather = weather.error ? null : weather;
                ambientWeatherError = !!weather.error;
                ambientWeatherKey = center.lat.toFixed(2) + ',' + center.lng.toFixed(2);
                ambientWeatherLabel = startPlace ? shortArea(startPlace) : (userCity || '当前位置');
                renderAmbientWeather(weather.error ? 'error' : undefined);
                console.log('当前天气: ' + weather.text + ' 场景:' + weather.precip + (weather.extreme ? ('/' + weather.extreme) : ''));
                setRoutesProgress(40, '正在筛选附近可以停留的地方…');
                // 3. POI
                return fetchPOIsP(center.lat, center.lng, radius);
            }).then(function (pois) {
                console.log('已加载 ' + pois.length + ' 个POI');
                drawMarkers(pois);
                setRoutesProgress(55, '正在为三条路线留出岔路…');
                var wText = currentWeather ? currentWeather.text : '未知';
                var placePrefs = buildPlacePreferences(selectedPlaceTypes);
                var sp = startCoords || userLocation || center;
                // 终点：有目的地用用户选择的终点；回起点模式用起点作为终点；走到哪算哪则无终点
                var ep = hasDestination ? endCoords : (returnToStart ? sp : null);
                // 距离预算：留出 15% 返程缓冲（回起点模式）+ 途经点停留时间按 3min/站 扣除
                var stayBufferMin = Math.min((pc.stops || 3) * 3, selectedMinutes * 0.3);
                var effectiveMinutes = Math.max(1, selectedMinutes - stayBufferMin);
                if (returnToStart) effectiveMinutes = effectiveMinutes * 0.85;
                var maxDistance = mc.speed * effectiveMinutes *
                    (currentWeather && currentWeather.extreme ? WEATHER_DIST_FACTOR : 1) * pc.budgetMul * 1.35;
                var accepted = [], rejected = [], attempts = 3;
                usedWaypointSets = {};
                var acceptedKeys = {};
                function candidateKey(c) {
                    return c && c.waypoints
                        ? c.waypoints.map(function (p) { return p.name; }).sort().join('>')
                        : '';
                }
                // 两条路线的几何重叠度（0~1）：比较途经点和起点终点的集合重合比例
                function routeOverlap(a, b) {
                    if (!a || !b) return 1;
                    var pointsA = new Set();
                    var pointsB = new Set();
                    [].concat(a.startPoint ? [a.startPoint] : [], a.waypoints || [], a.endPoint ? [a.endPoint] : []).forEach(function (p) {
                        if (p && p.lat && p.lng) pointsA.add(Math.round(p.lat * 1000) + ',' + Math.round(p.lng * 1000));
                    });
                    [].concat(b.startPoint ? [b.startPoint] : [], b.waypoints || [], b.endPoint ? [b.endPoint] : []).forEach(function (p) {
                        if (p && p.lat && p.lng) pointsB.add(Math.round(p.lat * 1000) + ',' + Math.round(p.lng * 1000));
                    });
                    var common = 0;
                    pointsA.forEach(function (k) { if (pointsB.has(k)) common++; });
                    var union = pointsA.size + pointsB.size - common;
                    return union === 0 ? 1 : common / union;
                }
                function tooSimilar(c) {
                    return accepted.some(function (a) { return routeOverlap(a, c) > 0.7; });
                }

                function nextCandidate() {
                    return buildCandidate(
                        center,
                        selectWaypoints(center, pois, selectedMinutes, lastPref, selectedMode, placePrefs),
                        wText, selectedMinutes, selectedMode, sp, ep, maxDistance
                    );
                }
                function collect(batchP, noProgress) {
                    return batchP.then(function (list) {
                        var before = accepted.length;
                        list.forEach(function (c) {
                            if (c && !c.tooLong && !c.error) {
                                var key = candidateKey(c);
                                if (acceptedKeys[key]) return;
                                // 跳过和已接受路线几何重叠度太高的候选，确保三条路线真正有差异
                                if (tooSimilar(c)) { rejected.push(c); return; }
                                acceptedKeys[key] = true;
                                accepted.push(c);
                            } else {
                                rejected.push(c);
                            }
                        });
                        setRoutesProgress(55 + Math.min(accepted.length, 3) * 11,
                            '正在为第 ' + Math.min(accepted.length + 1, 3) + ' 条路线寻找更少人走的岔路…');
                        if (accepted.length >= 3 || attempts >= 9) return accepted;
                        // 连续两批都没有新路线，说明附近可选组合已经用尽，别再空转
                        noProgress = accepted.length === before ? (noProgress || 0) + 1 : 0;
                        if (noProgress >= 2) return accepted;
                        var need = Math.min(3 - accepted.length, 9 - attempts);
                        attempts += need;
                        var batch = [];
                        for (var i = 0; i < need; i++) batch.push(nextCandidate());
                        return collect(Promise.all(batch), noProgress);
                    });
                }
                return collect(Promise.all([nextCandidate(), nextCandidate(), nextCandidate()]), 0)
                    .then(function (good) {
                        if (good.length >= 3) return good.slice(0, 3);
                        if (!good.length && rejected.every(function (c) { return c && c.error; })) {
                            throw new Error(rejected[0].error);
                        }
                        rejected.sort(function (a, b) {
                            if (a.error && !b.error) return 1;
                            if (!a.error && b.error) return -1;
                            return (a.distance || 0) - (b.distance || 0);
                        });
                        rejected.forEach(function (c) {
                            if (!c.reason) c.reason = '这条路线比预计的长一些，可以走到哪算哪，也可以中途折返。';
                        });
                        return good.concat(rejected.slice(0, 3 - good.length));
                    });
            }).then(function (candidates) {
                // 兜底去重：同一组途经点只保留一条
                var seenRoutes = {};
                candidates = candidates.filter(function (c) {
                    var key = c && c.waypoints
                        ? c.waypoints.map(function (p) { return p.name; }).sort().join('>')
                        : '';
                    if (seenRoutes[key]) return false;
                    seenRoutes[key] = true;
                    return true;
                });
                // 距离更合理的路线排在前面，错误/超长候选沉底
                candidates.sort(function (a, b) {
                    var ae = !!(a && (a.error || a.tooLong));
                    var be = !!(b && (b.error || b.tooLong));
                    if (ae !== be) return ae ? 1 : -1;
                    return (a.distance || Infinity) - (b.distance || Infinity);
                });
                lastCandidates = candidates;
                finishRoutesProgress();
                showRoutesModal({ candidates: lastCandidates, pref: lastPref, weather: currentWeather, minutes: selectedMinutes, mode: mc.label, backendMode: backendMode });
            }).catch(function (err) {
                stopRoutesProgress();
                console.error('生成候选路线失败', err);
                var raw = (err && err.message) ? err.message : '未知错误';
                var friendly = /(HTTP 5\d\d|abort|network|fetch)/i.test(raw)
                    ? '地图数据服务暂时繁忙（' + raw + '），可以稍后再试' : raw;
                var rb = document.getElementById('routes-body');
                if (rb) {
                    rb.innerHTML = '<div class="routes-loading">' +
                        '<p class="routes-loading-title">这次没有找到合适的岔路</p>' +
                        '<p class="routes-loading-sub">' + escapeHtml(friendly) + '</p>' +
                        '<div class="routes-error-actions">' +
                        '<button type="button" id="retry-btn" class="route-select" style="width:auto;padding:9px 18px">再试一次</button>' +
                        '<button type="button" id="back-btn" class="route-select route-select-ghost" style="width:auto;padding:9px 18px">返回调整偏好</button>' +
                        '</div>' +
                        '</div>';
                }
                var retry = document.getElementById('retry-btn');
                if (retry) retry.addEventListener('click', function () {
                    var body = document.getElementById('routes-body');
                    if (body) body.innerHTML = renderRoutesLoading();
                    startRoutesProgress();
                    loadCandidates();
                });
                var back = document.getElementById('back-btn');
                if (back) back.addEventListener('click', closeRoutesView);
            }).then(function () {
                setPrefBusy(false);
            });
    }

    // 根据选中的地点偏好构建类别权重(未选→默认, 选中→提升, 其余→降低)
    function buildPlacePreferences(selectedTypes) {
        if (!selectedTypes || selectedTypes.length === 0) return DEFAULT_PREFERENCES;
        var prefs = {};
        Object.keys(DEFAULT_PREFERENCES).forEach(function (k) { prefs[k] = 0.4; });
        selectedTypes.forEach(function (t) {
            if (prefs[t] != null) prefs[t] = 2.0;
        });
        return prefs;
    }

    var CN_TIME = { short: '短途', medium: '中途', long: '长途' };
    var CN_WALK = { low: '慢节奏', mid: '适中', high: '快节奏' };
    function cnLabel(map, v) { return (v != null && map[v]) || v || '默认'; }

    var CN_ROUTE = ['一', '二', '三'];

    function routeStopsHtml(c, cardIndex) {
        var parts = [];
        var auth = window.PianhangAuth;
        var logged = !!(auth && auth.isLoggedIn && auth.isLoggedIn());
        parts.push('<span class="route-stop is-start">' + escapeHtml(startPlace ? startPlace.name : '当前位置') + '</span>');
        (c.waypoints || []).forEach(function (p, wi) {
            if (p && p.name) {
                var fav = logged && !!(auth.isFavorite && auth.isFavorite(p));
                var typeLabel = (p.type && p.type !== p.name)
                    ? '<span class="route-stop-type">' + escapeHtml(p.type) + '</span>' : '';
                parts.push('<button type="button" class="route-stop route-stop-fav' + (fav ? ' is-favorite' : '') +
                    '" data-card="' + cardIndex + '" data-wp="' + wi + '" title="' +
                    (fav ? '取消收藏' : (logged ? '收藏这个地点' : '登录后收藏这个地点')) + '">' +
                    '<span class="route-stop-star" aria-hidden="true">' + (fav ? '★' : '☆') + '</span>' +
                    '<span class="route-stop-name">' + escapeHtml(p.name) + '</span>' + typeLabel + '</button>');
            } else {
                parts.push('<span class="route-stop">' + escapeHtml((p && p.name) || '未命名地点') + '</span>');
            }
        });
        if (c.endPoint) {
            parts.push('<span class="route-stop is-start">' + escapeHtml(endPlace ? endPlace.name : '终点') + '</span>');
        }
        return parts.join('<span class="route-stop-arrow" aria-hidden="true">→</span>');
    }

    // 弹窗：3条候选路线，每条含理由 + 地点箭头串联 + 选择按钮
    // ----- 路线卡片辅助：差异标签 -----
    function routeDiffBadge(c, i, all) {
        var wps = c.waypoints || [];
        var types = {};
        wps.forEach(function (p) { if (p && p.type) types[p.type] = (types[p.type] || 0) + 1; });
        // 找本路线最独有的类型（其他候选没有的）
        var uniqueType = null;
        var others = all.filter(function (_, j) { return j !== i; });
        for (var t in types) {
            var found = false;
            others.forEach(function (o) {
                (o.waypoints || []).forEach(function (p) { if (p && p.type === t) found = true; });
            });
            if (!found) { uniqueType = t; break; }
        }
        if (uniqueType) return uniqueType + ' 多';
        // 比其他候选少站
        var avg = others.length ? others.reduce(function (s, o) { return s + (o.waypoints || []).length; }, 0) / others.length : 0;
        if (wps.length < avg - 1) return '站少路短';
        if (wps.length > avg + 1) return '站多逛得久';
        return '';
    }

    function showRoutesModal(data) {
        var body = document.getElementById('routes-body');
        if (!body) return;
        stopRoutesProgress();
        var pref = data.pref || {};
        var modeLabel = (data.mode || '步行');
        var wText = data.weather ? weatherShort(data.weather) : '天气读取中';
        var wNote = (data.weather && !data.weather.error) ? weatherNote(data.weather) : '将按默认偏好生成';
        var sub = document.getElementById('routes-sub');
        if (sub) {
            sub.textContent = data.minutes + ' 分钟 · ' + modeLabel + ' · ' + wText +
                (wNote ? (' · ' + wNote) : '');
        }
        var html = '';
        html += '<div class="ai-block"><div class="ai-block-title">这次偏航的偏好</div><div class="pref-recap">';
        html += '<span class="ai-tag">时长 ' + escapeHtml(cnLabel(CN_TIME, pref.time_level)) + '</span>';
        html += '<span class="ai-tag">' + escapeHtml(cnLabel(CN_WALK, pref.walk_intensity)) + '</span>';
        html += '<span class="ai-tag">小众度 ' + Math.round((pref.novelty != null ? pref.novelty : 0.5) * 100) + '%</span>';
        html += '<span class="ai-tag">走巷度 ' + Math.round((pref.minor_level != null ? pref.minor_level : 0.5) * 100) + '%</span>';
        html += '</div>';
        if (selectedPlaceTypes.length) {
            var foundTypeMap = {};
            (data.candidates || []).forEach(function (c) {
                (c.waypoints || []).forEach(function (p) {
                    if (p && p.type) foundTypeMap[p.type] = true;
                });
            });
            var hitTypes = selectedPlaceTypes.filter(function (t) { return foundTypeMap[t]; });
            var missTypes = selectedPlaceTypes.filter(function (t) { return !foundTypeMap[t]; });
            if (hitTypes.length) {
                html += '<p class="route-pick-note">这次优先经过你选的地点：' +
                    hitTypes.map(function (t) { return escapeHtml(t); }).join(' · ') + '</p>';
            }
            if (missTypes.length) {
                html += '<p class="route-miss-note">附近暂时没找到「' +
                    missTypes.map(function (t) { return escapeHtml(t); }).join('、') +
                    '」，这几条路线先用其他真实地点补上了。</p>';
            }
        }
        html += '</div>';
        if (!data.candidates || !data.candidates.length) {
            html += '<div class="routes-loading"><p class="routes-loading-title">没有生成可用的路线</p>' +
                '<p class="routes-loading-sub">试着换一个起点，或缩短一点时间。</p></div>';
        }
        var canFav = !!(window.PianhangAuth && window.PianhangAuth.isLoggedIn && window.PianhangAuth.isLoggedIn());
        (data.candidates || []).forEach(function (c, i) {
            var distStr = c.distance ? ((c.distance / 1000).toFixed(2) + ' km') : '';
            var mc = MODE_CONFIG[selectedMode] || MODE_CONFIG.walk;
            var wpCount = (c.waypoints || []).length;
            var travelMin = mc.speed > 0 && c.distance ? Math.round(c.distance / mc.speed) : '';
            var stayMin = wpCount * 3;
            var totalMin = travelMin ? (travelMin + stayMin) + ' 分钟（走 ' + travelMin + ' + 逛 ' + stayMin + '）' : '';
            // 差异标签：优先展示途经点类型差异
            var diffBadge = routeDiffBadge(c, i, data.candidates);
            html += '<article class="route-card">' +
                '<div class="route-head"><div class="route-title-wrap">' +
                '<span class="route-index">0' + (i + 1) + '</span>' +
                '<span class="route-name">路线 ' + (CN_ROUTE[i] || (i + 1)) + '</span></div>' +
                (diffBadge ? '<span class="route-diff">' + diffBadge + '</span>' : '') +
                '<span class="route-meta">' + wpCount + ' 站' + (distStr ? (' · ' + distStr) : '') +
                (totalMin ? (' · 约 ' + totalMin) : '') + '</span></div>';
            html += '<p class="route-reason">' + escapeHtml(c.reason || '').replace(/\n/g, '<br>') + '</p>';
            html += '<div class="route-stops">' + routeStopsHtml(c, i) + '</div>';
            if (wpCount) {
                html += '<div class="route-fav-row">' +
                    '<button type="button" class="route-fav-all" data-card="' + i + '">' +
                    '<span class="route-fav-all-star" aria-hidden="true">☆</span>' +
                    '<span class="route-fav-all-label">收藏这 ' + wpCount + ' 个途经点</span></button>' +
                    '<p class="route-stop-hint">' + (canFav
                        ? '点途经点上的 ☆ 可单独收藏'
                        : '登录后可收藏喜欢的途经点') + '</p>' +
                    '</div>';
            }
            html += '<button type="button" class="route-select" data-route="' + i + '">' +
                '<span>选择这条路线</span><span class="btn-arrow" aria-hidden="true">→</span></button>';
            html += '</article>';
        });
        if (data.candidates && data.candidates.length && data.candidates.length < 3) {
            html += '<p class="route-approx-note">附近能走出不同路线的岔路不多，这次先给你 ' +
                data.candidates.length + ' 条。</p>';
        }
        var approx = (data.candidates || []).some(function (c) { return c.approx; });
        if (approx) {
            html += '<p class="route-approx-note">地图数据服务暂时繁忙，本次按附近方位生成街角路线。</p>';
        }
        html += '<div class="ai-foot">' + escapeHtml(data.backendMode || '偏航规则') + ' · 天气、节奏与地点偏好共同参与生成</div>';
        body.innerHTML = html;
        var btns = body.querySelectorAll('.route-select');
        Array.prototype.forEach.call(btns, function (b) {
            b.addEventListener('click', function () { selectRoute(parseInt(b.dataset.route, 10)); });
        });

        var auth = window.PianhangAuth;
        function favPayload(point) {
            return {
                name: point.name || '',
                type: point.type || '',
                lat: point.lat || 0,
                lng: point.lng || 0
            };
        }
        function requireLogin() {
            if (auth && auth.isLoggedIn && auth.isLoggedIn()) return false;
            if (auth && auth.openLogin) auth.openLogin();
            return true;
        }
        function syncChip(btn, point) {
            var fav = !!(auth && auth.isFavorite && auth.isFavorite(point));
            var canFavNow = !!(auth && auth.isLoggedIn && auth.isLoggedIn());
            btn.classList.toggle('is-favorite', fav);
            var star = btn.querySelector('.route-stop-star');
            if (star) star.textContent = fav ? '★' : '☆';
            btn.title = fav ? '取消收藏' : (canFavNow ? '收藏这个地点' : '登录后收藏这个地点');
        }
        function syncCardChips(cardIndex) {
            Array.prototype.forEach.call(
                body.querySelectorAll('.route-stop-fav[data-card="' + cardIndex + '"]'),
                function (btn) {
                    var candidate = lastCandidates[cardIndex];
                    var wi = parseInt(btn.getAttribute('data-wp'), 10);
                    var point = candidate && candidate.waypoints ? candidate.waypoints[wi] : null;
                    if (point) syncChip(btn, point);
                }
            );
        }
        function syncFavAll(btn, points) {
            var allFav = !!points.length && points.every(function (p) {
                return !!(auth && auth.isFavorite && auth.isFavorite(p));
            });
            btn.classList.toggle('is-favorite', allFav);
            var star = btn.querySelector('.route-fav-all-star');
            if (star) star.textContent = allFav ? '★' : '☆';
            var label = btn.querySelector('.route-fav-all-label');
            if (label) label.textContent = allFav ? '已收藏 · 取消收藏' : ('收藏这 ' + points.length + ' 个途经点');
        }

        var favBtns = body.querySelectorAll('.route-stop-fav');
        Array.prototype.forEach.call(favBtns, function (btn) {
            btn.addEventListener('click', function () {
                if (!auth || !auth.toggleFavorite) return;
                if (requireLogin()) return;
                var ci = parseInt(btn.getAttribute('data-card'), 10);
                var wi = parseInt(btn.getAttribute('data-wp'), 10);
                var candidate = lastCandidates[ci];
                var point = candidate && candidate.waypoints ? candidate.waypoints[wi] : null;
                if (!point) return;
                btn.disabled = true;
                auth.toggleFavorite(favPayload(point)).then(function () {
                    syncChip(btn, point);
                    var favAllBtn = body.querySelector('.route-fav-all[data-card="' + ci + '"]');
                    if (favAllBtn) {
                        syncFavAll(favAllBtn, (candidate.waypoints || []).filter(function (p) { return p && p.name; }));
                    }
                }).catch(function (err) {
                    console.warn('收藏失败: ' + (err && err.message));
                }).then(function () {
                    btn.disabled = false;
                });
            });
        });

        var favAllBtns = body.querySelectorAll('.route-fav-all');
        Array.prototype.forEach.call(favAllBtns, function (btn) {
            var ci = parseInt(btn.getAttribute('data-card'), 10);
            var candidate = lastCandidates[ci];
            var points = candidate && candidate.waypoints
                ? candidate.waypoints.filter(function (p) { return p && p.name; })
                : [];
            if (!auth || !auth.toggleFavorite || !points.length) {
                btn.hidden = true;
                return;
            }
            syncFavAll(btn, points);
            btn.addEventListener('click', function () {
                if (requireLogin()) return;
                var allFav = points.every(function (p) { return auth.isFavorite(p); });
                var toToggle = points.filter(function (p) {
                    return allFav ? auth.isFavorite(p) : !auth.isFavorite(p);
                });
                if (!toToggle.length) return;
                btn.disabled = true;
                var chain = Promise.resolve();
                toToggle.forEach(function (point) {
                    chain = chain.then(function () { return auth.toggleFavorite(favPayload(point)); });
                });
                chain.then(function () {
                    syncCardChips(ci);
                    syncFavAll(btn, points);
                }).catch(function (err) {
                    console.warn('批量收藏失败: ' + (err && err.message));
                }).then(function () {
                    btn.disabled = false;
                });
            });
        });
    }

    // 关闭推荐视图 → 回到偏好视图
    function closeRoutesView() {
        var vr = document.getElementById('view-routes');
        if (vr) vr.hidden = true;
        if (viewPref) { viewPref.hidden = false; revealView(viewPref); }
        setFlowStep(3);
        // 推荐页顶部天气可能来自起终点中点，回到偏好页时恢复起点/当前位置天气
        if (startPlace) refreshAmbientWeather(startPlace.lat, startPlace.lng, shortArea(startPlace));
        else if (userLocation) refreshAmbientWeather(userLocation.lat, userLocation.lng, userCity || '当前位置');
    }

    // 登录状态下，把选中的偏航写入个人足迹（同一条候选只记录一次）
    function recordDetour(c) {
        if (!c || c._recorded) return;
        var auth = window.PianhangAuth;
        if (!auth || !auth.isLoggedIn()) return;
        c._recorded = true;
        var w = currentWeather || ambientWeather;
        var startPoint = c.startPoint || startCoords || userLocation || null;
        var endPoint = c.endPoint || endCoords || null;
        var geometry = c.route && c.route.geometry && c.route.geometry.coordinates;
        var payload = {
            distance_km: Math.round((c.distance || 0) / 10) / 100,
            minutes: selectedMinutes || 0,
            mode: selectedMode || 'walk',
            start_name: (startPlace && startPlace.name) || (userCity ? ('当前位置 · ' + userCity) : '当前位置'),
            end_name: (endPlace && endPlace.name) || '',
            start_lat: startPoint ? startPoint.lat : 0,
            start_lng: startPoint ? startPoint.lng : 0,
            end_lat: endPoint ? endPoint.lat : 0,
            end_lng: endPoint ? endPoint.lng : 0,
            weather: w ? weatherShort(w) : '',
            waypoints: (c.waypoints || []).slice(0, 8).map(function (p) {
                return { name: p.name || '', type: p.type || '', lat: p.lat || 0, lng: p.lng || 0 };
            }),
            // 保存轨迹，偏航记录里可以重新打开这一条路线
            path: geometry && geometry.length ? geometry : []
        };
        auth.recordDetour(payload).catch(function (err) {
            c._recorded = false;
            console.warn('偏航记录保存失败: ' + (err && err.message));
        });
    }

    // 选中某条路线 → 隐藏推荐视图 → 显示探索屏 → 进入导航 → 绘制路线
    function selectRoute(i) {
        var c = lastCandidates && lastCandidates[i];
        if (!c) return;
        // 不立即记录——等用户点击"结束偏航"并确认后才写入手足迹
        var vr = document.getElementById('view-routes');
        if (vr) vr.hidden = true;
        if (viewExplore) { viewExplore.hidden = false; revealView(viewExplore); }
        setFlowStep(0);
        // 先进入导航模式(全屏)，等CSS布局稳定后再invalidateSize+绘制路线
        enterNav(c);
        setTimeout(function () {
            if (map) {
                map.invalidateSize();
                drawCandidateRoute(c);
            }
        }, 350);
    }

    // 计算两点间方位角(0=北,顺时针)
    function calcBearing(lat1, lng1, lat2, lng2) {
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var lat1r = lat1 * Math.PI / 180, lat2r = lat2 * Math.PI / 180;
        var y = Math.sin(dLng) * Math.cos(lat2r);
        var x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    // 沿路线每隔若干坐标放置一个方向箭头(chevron带状，更密集更大)
    function addRouteArrows(coords) {
        if (!coords || coords.length < 4 || !routeLayer) return;
        var step = Math.max(1, Math.floor(coords.length / 30)); // 约30个箭头，更密集
        for (var i = step; i < coords.length - 1; i += step) {
            var prev = coords[i - 1]; // [lng, lat]
            var curr = coords[i];
            var bearing = calcBearing(prev[1], prev[0], curr[1], curr[0]);
            var icon = L.divIcon({
                className: 'route-arrow',
                html: '<div class="route-arrow-icon" style="transform: rotate(' + (bearing - 45) + 'deg)"></div>',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });
            L.marker([curr[1], curr[0]], { icon: icon, interactive: false, keyboard: false }).addTo(routeLayer);
        }
    }

    // 将GeoJSON LineString坐标(lon,lat, WGS-84)整体转为GCJ-02，用于绘制到高德瓦片
    function lineToMapGeojson(geometry) {
        if (!geometry || !geometry.coordinates) return geometry;
        var coords = geometry.coordinates.map(function (c) {
            var g = wgs84ToGcj02(c[1], c[0]);
            return [g.lng, g.lat];
        });
        return { type: 'LineString', coordinates: coords };
    }

    function drawCandidateRoute(c) {
        if (!routeLayer || !map) return;
        routeLayer.clearLayers();
        // 起点：优先用路线实际起点(可能有目的地时为自定义起点)
        var startPoint = c.startPoint || userLocation || { lat: 31.2304, lng: 121.4737 };
        var startIcon = L.divIcon({
            className: 'start-marker',
            html: '<div class="start-pulse"></div><div class="start-dot"></div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });
        var startLabel = c.startLabel || (startPlace ? startPlace.name : '当前位置');
        L.marker(toMapLatLng(startPoint.lat, startPoint.lng), { icon: startIcon })
            .bindPopup('<div style="font-size:14px"><b>起点</b><br>' + escapeHtml(startLabel) + '</div>').addTo(routeLayer);
        // 途经点（带数字圆点，更明显）
        c.waypoints.forEach(function (p, idx) {
            var wpIcon = L.divIcon({
                className: 'wp-marker',
                html: '<div class="wp-circle" style="background:' + (p.color || '#3b82f6') + '">' + (idx + 1) + '</div>',
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            var wp = L.marker(toMapLatLng(p.lat, p.lng), { icon: wpIcon });
            bindIntroPopup(wp, (idx + 1) + '. ' + p.name, p);
            wp.addTo(routeLayer);
        });
        // 终点(有目的地时显示)
        if (c.endPoint) {
            var endIcon = L.divIcon({
                className: 'start-marker',
                html: '<div class="end-dot"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });
            var endLabel = c.endLabel || (endPlace ? endPlace.name : '目的地');
            L.marker(toMapLatLng(c.endPoint.lat, c.endPoint.lng), { icon: endIcon })
                .bindPopup('<div style="font-size:14px"><b>终点</b><br>' +
                    escapeHtml(endLabel) + '</div>').addTo(routeLayer);
        }
        // 路线：白色描边 + 亮蓝主线 + 白色虚线(流动感) + 方向箭头（几何转GCJ-02与高德瓦片对齐）
        if (c.route && c.route.geometry) {
            var mapGeom = lineToMapGeojson(c.route.geometry);
            // 底：白色描边
            L.geoJSON(mapGeom, { style: { color: '#ffffff', weight: 12, opacity: 0.95, lineCap: 'round', lineJoin: 'round' } }).addTo(routeLayer);
            // 主：亮蓝色粗线
            L.geoJSON(mapGeom, { style: { color: '#1d6ef9', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round' } }).addTo(routeLayer);
            // 叠：白色短虚线，模拟车道流动感，辅助判断方向
            L.geoJSON(mapGeom, { style: { color: '#ffffff', weight: 3, opacity: 0.85, dashArray: '1 12', lineCap: 'round' } }).addTo(routeLayer);
            addRouteArrows(mapGeom.coordinates);
        }
        // 以路线起点为地图中心显示路线
        try { map.setView(toMapLatLng(startPoint.lat, startPoint.lng), 15); } catch (e) {}
    }

    // 导航界面：切换为全屏沉浸式导航，隐藏POI标记，显示导航浮层
    // 选中路线引用——结束偏航时才记录完成
    var currentNavRoute = null;

    function enterNav(c) {
        currentNavRoute = c;
        document.body.classList.add('nav-mode');
        if (prefSection) prefSection.hidden = true;
        // 导航时只显示路线，隐藏所有POI标记，界面更清爽
        if (poiLayer && map) map.removeLayer(poiLayer);
        var bar = document.getElementById('nav-bar');
        if (!bar) return;
        var distStr = c.distance ? ((c.distance / 1000).toFixed(2) + ' km') : '';
        var names = c.waypoints.map(function (p) { return p.name; });
        var chain = [];
        if (startPlace) chain.push(startPlace.name);
        chain = chain.concat(names);
        if (c.endPoint && endPlace) chain.push(endPlace.name);
        var mc = MODE_CONFIG[selectedMode] || MODE_CONFIG.walk;
        var w = currentWeather || ambientWeather;
        var wText = w ? weatherShort(w) : '';
        bar.innerHTML = '<div class="nav-info"><span class="nav-title">偏航导航中</span>' +
            '<span class="nav-route">' + escapeHtml(chain.join(' → ')) + '</span></div>' +
            '<div class="nav-meta">' + c.waypoints.length + '站' +
            (distStr ? (' · ' + distStr) : '') + ' · ' + mc.label + ' · 约' + selectedMinutes + '分钟</div>' +
            (wText ? '<span class="nav-weather">' + escapeHtml(wText) + '</span>' : '') +
            '<button type="button" id="nav-end" class="nav-end">结束偏航</button>';
        bar.hidden = false;
        var endBtn = document.getElementById('nav-end');
        if (endBtn) endBtn.addEventListener('click', function () {
            if (window.confirm('确认完成这次偏航吗？\n\n点击"确定"后，这条路线将写入你的足迹。')) {
                if (currentNavRoute) recordDetour(currentNavRoute);
                exitNav();
            }
        });
    }

    function exitNav() {
        currentNavRoute = null;
        document.body.classList.remove('nav-mode');
        var bar = document.getElementById('nav-bar');
        if (bar) bar.hidden = true;
        if (prefSection) prefSection.hidden = false;
        // 退出导航时恢复POI标记
        if (poiLayer && map) poiLayer.addTo(map);
        if (routeLayer) routeLayer.clearLayers();
        setTimeout(function () { if (map) map.invalidateSize(); }, 200);
    }

    // ===== 偏航记录回放：把历史记录重新画到地图上 =====
    var pendingReplay = null;
    var replayingDetour = false;
    var toastTimer = null;

    function showMapNotice(text) {
        var el = document.getElementById('ph-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ph-toast';
            el.className = 'ph-toast';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.classList.add('visible');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.classList.remove('visible');
            toastTimer = null;
        }, 3200);
    }

    function validReplayCoord(lat, lng) {
        return typeof lat === 'number' && typeof lng === 'number' &&
            isFinite(lat) && isFinite(lng) &&
            !(Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7);
    }

    function detourReplayPath(d) {
        if (!Array.isArray(d && d.path)) return [];
        return d.path.filter(function (pair) {
            return Array.isArray(pair) && pair.length >= 2 &&
                validReplayCoord(pair[1], pair[0]);
        });
    }

    function detourReplayCandidate(d) {
        var path = detourReplayPath(d);
        var wps = (d.waypoints || []).filter(function (p) {
            return p && p.name && validReplayCoord(p.lat, p.lng);
        }).map(function (p) {
            var cat = poiCategoryByLabel(p.type);
            return {
                name: p.name,
                type: p.type || '地点',
                lat: p.lat,
                lng: p.lng,
                color: p.color || (cat ? cat.color : '#3b82f6')
            };
        });
        var startPoint = validReplayCoord(d.start_lat, d.start_lng)
            ? { lat: d.start_lat, lng: d.start_lng }
            : (path.length ? { lat: path[0][1], lng: path[0][0] }
                : (wps[0] ? { lat: wps[0].lat, lng: wps[0].lng } : null));
        if (!startPoint) return null;
        var endPoint = validReplayCoord(d.end_lat, d.end_lng)
            ? { lat: d.end_lat, lng: d.end_lng } : null;
        return {
            waypoints: wps,
            startPoint: startPoint,
            endPoint: endPoint,
            route: path.length > 1 ? { geometry: { type: 'LineString', coordinates: path } } : null,
            distance: Number(d.distance_km || 0) * 1000,
            startLabel: d.start_name || '起点',
            endLabel: d.end_name || '目的地',
            replay: true
        };
    }

    function isHomeRoute() {
        var name = (location.hash || '').replace(/^#\/?/, '').split('/')[0].split('?')[0];
        return !name || name === 'home';
    }

    function replayTimeLabel(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
            String(date.getHours()).padStart(2, '0') + ':' +
            String(date.getMinutes()).padStart(2, '0');
    }

    function drawReplayRoute(c) {
        if (!routeLayer || !map) return;
        drawCandidateRoute(c);
        var points = [];
        if (c.route && c.route.geometry) {
            c.route.geometry.coordinates.forEach(function (pair) {
                if (Array.isArray(pair) && pair.length >= 2) {
                    points.push(toMapLatLng(pair[1], pair[0]));
                }
            });
        }
        c.waypoints.forEach(function (p) { points.push(toMapLatLng(p.lat, p.lng)); });
        if (c.startPoint) points.push(toMapLatLng(c.startPoint.lat, c.startPoint.lng));
        if (c.endPoint) points.push(toMapLatLng(c.endPoint.lat, c.endPoint.lng));
        if (points.length > 1) {
            map.fitBounds(L.latLngBounds(points), { padding: [70, 70], maxZoom: 17 });
        } else if (points.length === 1) {
            map.setView(points[0], 16);
        }
    }

    function enterReplayBar(d) {
        var bar = document.getElementById('nav-bar');
        if (!bar) return;
        var chain = [d.start_name || '起点'];
        (d.waypoints || []).forEach(function (p) {
            if (p && p.name) chain.push(p.name);
        });
        if (d.end_name) chain.push(d.end_name);
        var mc = MODE_CONFIG[d.mode] || MODE_CONFIG.walk;
        var bits = [];
        if ((d.waypoints || []).length) bits.push(d.waypoints.length + ' 站');
        bits.push(Number(d.distance_km || 0).toFixed(2) + ' km');
        bits.push(mc.label);
        if (d.weather) bits.push(d.weather);
        var when = replayTimeLabel(d.created_at);
        bar.innerHTML = '<div class="nav-info"><span class="nav-title">偏航回放' +
            (when ? ' · ' + escapeHtml(when) : '') + '</span>' +
            '<span class="nav-route">' + escapeHtml(chain.join(' → ')) + '</span></div>' +
            '<div class="nav-meta">' + escapeHtml(bits.join(' · ')) + '</div>' +
            '<button type="button" id="nav-end" class="nav-end">退出回放</button>';
        bar.hidden = false;
        var endBtn = document.getElementById('nav-end');
        if (endBtn) endBtn.addEventListener('click', exitReplay);
    }

    function runPendingReplay() {
        if (!pendingReplay) return;
        var d = pendingReplay;
        var c = detourReplayCandidate(d);
        if (!c) {
            pendingReplay = null;
            showMapNotice('这条旧记录没有保存轨迹坐标，下一次偏航会自动记录。');
            return;
        }
        pendingReplay = null;
        replayingDetour = true;
        var routesView = document.getElementById('view-routes');
        if (routesView) routesView.hidden = true;
        if (viewStart) viewStart.hidden = true;
        if (viewDest) viewDest.hidden = true;
        if (viewPref) viewPref.hidden = true;
        if (viewExplore) { viewExplore.hidden = false; revealView(viewExplore); }
        setFlowStep(0);
        document.body.classList.add('nav-mode');
        if (prefSection) prefSection.hidden = true;
        if (poiLayer && map && map.hasLayer(poiLayer)) map.removeLayer(poiLayer);
        enterReplayBar(d);
        setTimeout(function () {
            if (!map) return;
            map.invalidateSize();
            drawReplayRoute(c);
        }, 350);
    }

    function cleanupReplay() {
        replayingDetour = false;
        document.body.classList.remove('nav-mode');
        var bar = document.getElementById('nav-bar');
        if (bar) {
            bar.hidden = true;
            bar.innerHTML = '';
        }
        if (routeLayer) routeLayer.clearLayers();
        if (poiLayer && map && !map.hasLayer(poiLayer)) poiLayer.addTo(map);
        if (prefSection) prefSection.hidden = false;
    }

    function exitReplay() {
        cleanupReplay();
        if (location.hash !== '#/history') location.hash = '#/history';
        setTimeout(function () { if (map) map.invalidateSize(); }, 300);
    }

    function replayDetour(d) {
        if (!d) return;
        var c = detourReplayCandidate(d);
        if (!c) {
            showMapNotice('这条旧记录没有保存轨迹坐标，下一次偏航会自动记录。');
            return;
        }
        pendingReplay = d;
        if (isHomeRoute()) {
            setTimeout(runPendingReplay, 40);
        } else {
            location.hash = '#/home';
        }
    }

    window.addEventListener('hashchange', function () {
        if (replayingDetour) cleanupReplay();
        if (pendingReplay && isHomeRoute()) {
            setTimeout(runPendingReplay, 900);
        }
    });

    window.PianhangReplay = { open: replayDetour };

    // Overpass 公共端点列表(主端点易限流/中断；并行竞速，谁先成功用谁)
    var OVERPASS_ENDPOINTS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
        'https://overpass.private.coffee/api/interpreter'
    ];
    var OVERPASS_TIMEOUT_MS = 6000; // 单个端点超时；并行竞速，总等待不超过这个值

    // 同时请求所有镜像，避免被某一个繁忙端点拖住；全部失败才 reject
    function fetchOverpassQuery(query, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var body = 'data=' + encodeURIComponent(query);
            var pending = OVERPASS_ENDPOINTS.length;
            var settled = false;
            var errors = [];
            var controllers = [];

            OVERPASS_ENDPOINTS.forEach(function (url) {
                var controller = new AbortController();
                controllers.push(controller);
                var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
                function fail(err) {
                    clearTimeout(timer);
                    if (settled) return;
                    errors.push(url.replace(/^https?:\/\//, '').split('/')[0] + ': ' + (err && err.message ? err.message : err));
                    pending--;
                    if (pending === 0) {
                        settled = true;
                        reject(new Error(errors.join('；')));
                    }
                }
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
                    body: body,
                    signal: controller.signal
                }).then(function (r) {
                    clearTimeout(timer);
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                }).then(function (data) {
                    if (settled) return;
                    settled = true;
                    controllers.forEach(function (c) { try { c.abort(); } catch (e) {} });
                    resolve((data && data.elements) || []);
                }).catch(fail);
            });
        });
    }

    // 在指定方位上偏移一定距离（WGS-84）
    function offsetLatLng(pt, bearing, meters) {
        var rad = bearing * Math.PI / 180;
        return {
            lat: pt.lat + (meters * Math.cos(rad)) / 111320,
            lng: pt.lng + (meters * Math.sin(rad)) / (111320 * Math.cos(pt.lat * Math.PI / 180))
        };
    }

    // 把点拉回到搜索半径内，避免途经点被后续可行性筛选丢掉
    function clampToRadius(center, pt, maxMeters) {
        var d = distanceMeters(center, pt);
        if (d <= maxMeters) return pt;
        var t = maxMeters / d;
        return {
            lat: center.lat + (pt.lat - center.lat) * t,
            lng: center.lng + (pt.lng - center.lng) * t
        };
    }

    // 高德返回的 3 条道路、3 个路口和附近地标直接组成地点池。
    // 全部使用上游返回的真实坐标，避免外推到围栏/院落另一侧导致路线绕行。
    function amapRegeoToPOIs(data, sample, radius, center) {
        center = center || sample;
        var pois = [], seen = {};
        function push(p) {
            if (!p || !p.name) return;
            var key = p.name + '|' + p.lat.toFixed(4) + ',' + p.lng.toFixed(4);
            if (seen[key]) return;
            seen[key] = true;
            pois.push(p);
        }

        var landmark = amapLandmarkName(data);
        if (landmark) {
            push({ lat: sample.lat, lng: sample.lng, name: landmark, type: '地标',
                color: '#eab308', source: 'amap' });
        }

        // 路口优先：它们一定落在道路交叉处，比路段中间点更容易直接走到
        ((data && data.crosses) || []).slice(0, 4).forEach(function (c) {
            var w = gcj02ToWgs84(c.lat, c.lng);
            push({ lat: w.lat, lng: w.lng,
                name: String(c.name || '').replace(/--/g, ' · '),
                type: '路口', color: '#64748b', source: 'amap' });
        });

        // 路口不足时才补充路段名，保证偏远地区也有足够地点
        if (pois.length < SELECTED_COUNT) {
            ((data && data.roads) || []).slice(0, 3).forEach(function (road) {
                var w = gcj02ToWgs84(road.lat, road.lng);
                w = clampToRadius(center, w, radius * 0.7);
                push({ lat: w.lat, lng: w.lng, name: road.name, type: '街道',
                    color: '#94a3b8', source: 'amap' });
            });
        }

        return pois;
    }

    // 取确定性的采样点：同一方向由近到远展开，再补两个侧向点。
    // 同一位置重复生成时命中后端缓存，采样点越分散，能拿到的“附近地标”越多。
    function amapSamplePoints(center, radius) {
        var d = Math.max(150, Math.min(radius * 0.3, 480));
        var seed = Math.abs(Math.sin(center.lat * 12.9898 + center.lng * 78.233) * 43758.5453);
        var base = (seed - Math.floor(seed)) * 360;
        var d2 = Math.min(d * 2, Math.max(d + 140, radius * 0.55));
        return [
            offsetLatLng(center, base, d),
            offsetLatLng(center, base, d2),
            offsetLatLng(center, base + 120, d),
            offsetLatLng(center, base + 240, d)
        ];
    }

    // ===== Photon（OSM 真实地点检索） =====
    // 高德逆地理只返回道路和路口，直接拿来当途经点会得到一串街道名。
    // Photon 可以按 OSM 标签检索真实的店、公园、书店等，因此作为首选地点源。
    var PHOTON_BASE = 'https://photon.komoot.io/api/';

    function photonTerm(tag) {
        var val = String(tag || '').split(':')[1] || '';
        return val.replace(/_/g, ' ');
    }

    function photonBBox(center, radius) {
        var latD = radius / 111320;
        var cosLat = Math.cos(center.lat * Math.PI / 180) || 1;
        var lngD = radius / (111320 * cosLat);
        var pad = 1.15;
        return [center.lng - lngD * pad, center.lat - latD * pad,
            center.lng + lngD * pad, center.lat + latD * pad].map(function (n) {
            return n.toFixed(5);
        }).join(',');
    }

    function photonSearchP(center, radius, tag) {
        var url = PHOTON_BASE + '?q=' + encodeURIComponent(photonTerm(tag)) +
            '&osm_tag=' + encodeURIComponent(tag) +
            '&bbox=' + photonBBox(center, radius) +
            '&limit=30&lat=' + center.lat.toFixed(5) + '&lon=' + center.lng.toFixed(5);
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            return (data && data.features) || [];
        });
    }

    // labels 为空时检索全部 6 类（每类只用主标签，控制请求数量）；
    // 指定了用户勾选类型时，使用该类型的全部标签，尽量把地点找全。
    function photonPOIsP(center, radius, labels) {
        var selected = !!(labels && labels.length);
        var cats = (selected ? labels : POI_CATEGORIES.map(function (c) { return c.label; }))
            .map(poiCategoryByLabel).filter(Boolean);
        var tasks = [];
        cats.forEach(function (cat) {
            var tags = selected ? (cat.photonTags || []) : [(cat.photonTags || [])[0]];
            tags.filter(Boolean).forEach(function (tag) {
                tasks.push(photonSearchP(center, radius, tag).then(function (features) {
                    var out = [];
                    features.forEach(function (f) {
                        var prop = (f && f.properties) || {};
                        var coord = f && f.geometry && f.geometry.coordinates;
                        if (!coord || coord.length < 2) return;
                        if ((prop.osm_key + ':' + prop.osm_value) !== tag) return;
                        var name = String(prop.name || '').trim();
                        if (!name) return;
                        var lat = Number(coord[1]), lng = Number(coord[0]);
                        if (!isFinite(lat) || !isFinite(lng)) return;
                        if (distanceMeters(center, { lat: lat, lng: lng }) > radius * 1.08) return;
                        out.push({
                            lat: lat, lng: lng, name: name, type: cat.label,
                            color: cat.color, source: 'photon', placeKind: prop.osm_value || ''
                        });
                    });
                    return out;
                }).catch(function (err) {
                    console.warn('Photon 搜索「' + tag + '」失败: ' + (err && err.message));
                    return [];
                }));
            });
        });
        return Promise.all(tasks).then(function (lists) {
            var out = [], seen = {};
            lists.forEach(function (list) {
                (list || []).forEach(function (p) {
                    var key = p.name + '|' + p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
                    if (seen[key]) return;
                    seen[key] = true;
                    out.push(p);
                });
            });
            return out;
        });
    }

    function mergePOIs(lists) {
        var out = [], seen = {};
        lists.forEach(function (list) {
            (list || []).forEach(function (p) {
                if (!p || !p.name) return;
                var key = p.type + '|' + p.name;
                if (seen[key]) return;
                seen[key] = true;
                out.push(p);
            });
        });
        return out;
    }

    function overpassPOIsP(lat, lng, radius) {
        var query = buildOverpassQuery(lat, lng, Math.min(radius, 2000));
        return fetchOverpassQuery(query, OVERPASS_TIMEOUT_MS).then(function (elements) {
            var pois = elementsToPOIs(elements || []);
            if (!pois.length) throw new Error('附近未返回可用地点');
            return pois;
        });
    }

    // 最后的兜底：所有数据源都失败时，按附近方位生成街角点，保证流程还能继续
    function directionalCornerPOIs(center, radius) {
        console.warn('地点数据不可用，按附近方位生成街角路线');
        var span = Math.max(180, Math.min(radius * 0.42, 650));
        var dirs = ['北侧', '东北侧', '东侧', '东南侧', '南侧', '西南侧', '西侧', '西北侧'];
        return dirs.map(function (name, i) {
            var pt = offsetLatLng(center, i * 45, span * (0.7 + (i % 3) * 0.15));
            return { lat: pt.lat, lng: pt.lng, name: name + '街角', type: '街角',
                color: '#94a3b8', fallback: true, approx: true };
        });
    }

    // 高德逆地理：只作为“真实地点不足”时的兜底（地标、路口、道路）
    function amapFallbackPOIsP(center, radius) {
        return Promise.all(amapSamplePoints(center, radius).map(function (sample) {
            return amapRegeo(sample.lat, sample.lng, 8000).then(function (data) {
                return amapRegeoToPOIs(data, sample, radius, center);
            }).catch(function (err) {
                console.warn('高德采样点失败（' + err.message + '）');
                return [];
            });
        })).then(function (lists) {
            return mergePOIs(lists);
        });
    }

    // 地点数据源优先级：
    // 1. Photon 的真实地点（用户勾选类型优先）——避免途经点全是街道名
    // 2. Overpass 真实地点补充
    // 3. 高德地标/路口，最后才是道路
    // 4. 方位街角兜底（保证流程不中断）
    function fetchPOIs(lat, lng, radius, cb) {
        var searchRadius = Math.min(radius, 2000);
        var center = { lat: lat, lng: lng };

        photonPOIsP(center, searchRadius, selectedPlaceTypes).then(function (first) {
            var covered = selectedPlaceTypes.every(function (t) {
                return first.some(function (p) { return p.type === t; });
            });
            if ((first.length >= SELECTED_COUNT && covered) || !selectedPlaceTypes.length) return first;
            // 勾选类型的地点不够/没覆盖全时，补充其他类别，保证路线尽量停进用户选的地方
            return photonPOIsP(center, searchRadius, null).then(function (all) {
                return mergePOIs([first, all]);
            });
        }).catch(function (err) {
            console.warn('Photon 不可用（' + (err && err.message) + '）');
            return [];
        }).then(function (real) {
            if (real.length >= SELECTED_COUNT) {
                console.log('真实地点源返回 ' + real.length + ' 个：' +
                    real.slice(0, 10).map(function (p) { return p.name + '[' + p.type + ']'; }).join('、'));
                cb(null, real);
                return null;
            }
            console.log('真实地点不足（' + real.length + ' 个），尝试 Overpass 补充');
            return overpassPOIsP(lat, lng, searchRadius).catch(function (err2) {
                console.warn('Overpass 补充也不可用（' + err2.message + '）');
                return [];
            }).then(function (osm) {
                var places = mergePOIs([real, osm]);
                if (places.length >= SELECTED_COUNT) {
                    cb(null, places);
                    return null;
                }
                return amapFallbackPOIsP(center, searchRadius).then(function (amap) {
                    // 高德的地标/路口比道路更像“地点”，道路只在最后补足
                    var nonRoads = (amap || []).filter(function (p) { return p.type !== '街道'; });
                    var roads = (amap || []).filter(function (p) { return p.type === '街道'; });
                    var merged = mergePOIs([places, nonRoads]);
                    if (merged.length < SELECTED_COUNT) merged = mergePOIs([merged, roads]);
                    if (!merged.length) merged = directionalCornerPOIs(center, searchRadius);
                    cb(null, merged);
                });
            });
        }).catch(function (err) {
            console.warn('地点数据全部不可用（' + (err && err.message) + '），使用方位街角兜底');
            cb(null, directionalCornerPOIs(center, searchRadius));
        });
    }

    startBtn.addEventListener('click', showDestQuestion);
    if (destYes) destYes.addEventListener('click', function () { enterPrefView(true, false); });
    if (destRoundtrip) destRoundtrip.addEventListener('click', function () { enterPrefView(false, true); });
    if (destWander) destWander.addEventListener('click', function () { enterPrefView(false, false); });

    // 推荐视图返回按钮 → 回到偏好视图
    var routesCloseBtn = document.getElementById('routes-close');
    if (routesCloseBtn) routesCloseBtn.addEventListener('click', closeRoutesView);

    updateStartButton();
    updateUserPlaceDefaults();
    setFlowStep(1);
})();
