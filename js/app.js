// 偏航 Web App - app.js
// 步骤3：基于Leaflet地图，调用Overpass API获取周边POI，绘制Marker并弹窗显示名称

(function () {
    'use strict';

    // ===== 时间选择：自选时间轮盘 =====
    var selectedMinutes = null;
    var startBtn = document.getElementById('start-btn');
    var viewStart = document.getElementById('view-start');
    var viewExplore = document.getElementById('view-explore');
    var enteredExplore = false;
    var timePickBtn = document.getElementById('time-pick-btn');
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
    }

    function formatDuration(minutes) {
        if (minutes < 60) return minutes + ' 分钟';
        var h = Math.floor(minutes / 60), m = minutes % 60;
        return h + ' 小时' + (m ? (' ' + m + ' 分钟') : '');
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
    var hasDestination = false;          // 是否有目的地
    var startCoords = null;              // 起点坐标 {lat,lng}
    var endCoords = null;                // 终点坐标 {lat,lng}

    var viewDest = document.getElementById('view-dest');
    var viewPref = document.getElementById('view-pref');
    var destYes = document.getElementById('dest-yes');
    var destNo = document.getElementById('dest-no');

    // 开始偏航 → 显示"是否有目的地"问询屏
    function showDestQuestion() {
        if (viewStart) viewStart.hidden = true;
        if (viewDest) viewDest.hidden = false;
    }

    // 进入偏航偏好界面：隐藏问询屏、显示偏好视图，有目的地时显示起终点
    function enterPrefView(hasDest) {
        hasDestination = !!hasDest;
        if (viewDest) viewDest.hidden = true;
        if (viewPref) viewPref.hidden = false;
        var routeBlock = document.getElementById('route-block');
        if (routeBlock) routeBlock.hidden = !hasDestination;
        // 首次进入时定位用户(后续生成路线时需要)
        if (!enteredExplore) {
            enteredExplore = true;
            locateUser();
        }
    }

    // 从偏好界面进入推荐界面：隐藏偏好、显示推荐视图(加载中)、生成路线
    function enterExploreFromPref() {
        if (viewPref) viewPref.hidden = true;
        var vr = document.getElementById('view-routes');
        var rb = document.getElementById('routes-body');
        if (vr) vr.hidden = false;
        if (rb) rb.innerHTML = '<div class="routes-loading">正在生成偏航路线…</div>';
        loadCandidates();
    }

    var prefSection = document.querySelector('.pref-section');
    var userLocation = null;  // 用户位置(静默IP定位)，仅作无目的地兜底起点，不展示UI
    var userMarker = null;    // 用户位置标记(常驻地图)

    // 统一更新用户位置：移动地图标记 + 记录到 userLocation + 回调
    function applyUserLocation(lat, lng, source, accuracy) {
        userLocation = { lat: lat, lng: lng };
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
        console.log('[' + source + (accuracy ? ' ±' + Math.round(accuracy) + 'm' : '') + '] 已定位用户位置: (' + lat.toFixed(4) + ',' + lng.toFixed(4) + ')');
    }

    // IP 定位：免费接口 ip-api.com（无需key，返回经纬度）；失败则回退默认(上海中心)
    // 返回 Promise，resolve 位置或 null
    function ipLocate() {
        var urls = [
            'https://ip-api.com/json/?lang=zh-CN&fields=status,lat,lon,city',
            'https://ipapi.co/json/',
            'https://ipinfo.io/json'
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
                var lat = parseFloat(d.lat), lon = parseFloat(d.lon || d.lng);
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

    // 静默定位：仅用IP定位作为地图初始中心/无目的地兜底起点，不展示任何定位UI
    function locateUser(callback) {
        ipLocate().then(function (ip) {
            if (ip) {
                applyUserLocation(ip.lat, ip.lng, 'IP');
            } else if (map) {
                map.setView([31.2304, 121.4737], 13);
            }
            if (callback) callback(ip ? { lat: ip.lat, lng: ip.lng } : null);
        });
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
        if (timePickBtn) { timePickBtn.textContent = '自选'; timePickBtn.classList.add('active'); }
        if (timeChosenEl) { timeChosenEl.textContent = '已选时间：' + formatDuration(total); timeChosenEl.hidden = false; }
        updateStartButton();
    }

    // 预设按钮：30/60 分钟
    function selectPreset(el) {
        selectedMinutes = parseInt(el.dataset.minutes, 10);
        timePresets.forEach(function (x) { x.classList.remove('active'); });
        el.classList.add('active');
        if (timePickBtn) { timePickBtn.classList.remove('active'); timePickBtn.textContent = '自选'; }
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
        { key: 'park',       label: '公园',   osm: { leisure: 'park' },      color: '#22c55e' },
        { key: 'cafe',       label: '咖啡店', osm: { amenity: 'cafe' },      color: '#b45309' },
        { key: 'books',      label: '书店',   osm: { shop: 'books' },        color: '#3b82f6' },
        { key: 'museum',     label: '博物馆', osm: { tourism: 'museum' },    color: '#9333ea' },
        { key: 'plaza',      label: '广场',   osm: { place: 'square' },      color: '#f97316' },
        { key: 'attraction', label: '景点',   osm: { tourism: 'attraction' },color: '#ef4444' }
    ];

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

    // 绑定地点弹窗：点击Marker时调用后端获取简短介绍(loading→更新)
    function bindIntroPopup(marker, displayName, p) {
        var base = '<div style="font-size:14px;line-height:1.5">' +
            '<b style="color:#0f172a">' + displayName + '</b><br>' +
            '<span style="color:#64748b">' + p.type + '</span></div>';
        marker.bindPopup(base + '<div style="color:#64748b;font-size:11px;margin-top:4px">加载介绍…</div>');
        marker.on('click', function () {
            aiPost('/api/get_intro', { name: p.name, type: p.type }).then(function (r) {
                var intro = (r && r.text) ? r.text : '暂无介绍';
                marker.setPopupContent(base +
                    '<div style="color:#334155;font-size:11px;margin-top:4px;line-height:1.5">' + intro + '</div>');
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

    function pickRandom(arr, n) {
        var copy = arr.slice(), out = [];
        while (out.length < n && copy.length) {
            out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
        }
        return out;
    }

    // 规则3：结合天气 + AI偏好 + 出行方式 + 地点偏好 → 过滤 → 打分 → 取高分候选池 → 随机挑选3个途经点
    function selectWaypoints(center, pois, minutes, parsedPref, mode, placePrefs) {
        var w = currentWeather || { precip: 'cloudy', extreme: null, text: '未知(默认)' };
        var prefs = buildWeatherPreferences(w.precip, placePrefs || DEFAULT_PREFERENCES);
        var mc = MODE_CONFIG[mode] || MODE_CONFIG.walk;
        // 步行强度影响搜索半径：low=收紧, high=放大
        var intensityFactor = 1.0;
        if (parsedPref && parsedPref.walk_intensity === 'low') intensityFactor = 0.8;
        else if (parsedPref && parsedPref.walk_intensity === 'high') intensityFactor = 1.2;
        var maxR = Math.round(feasibleRadiusFor(minutes, w.extreme) * mc.radiusMul * intensityFactor);
        var budget = mc.speed * minutes * (w.extreme ? WEATHER_DIST_FACTOR : 1) * intensityFactor;
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
        var K = Math.min(Math.max(scored.length, SELECTED_COUNT), 12); // 高分候选池上限12
        var pool = scored.slice(0, K);
        var picked = pickRandom(pool, Math.min(SELECTED_COUNT, pool.length));
        console.log('偏航筛选(' + wLabel + '): 半径' + maxR + 'm 可行' + feasible.length +
            ' → 高分候选' + pool.length + ' → 选中' + picked.length + ' 个途经点');
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


    // ===== AI候选路线（后端Mock，步骤7；密钥保管在后端，前端不含任何大模型密钥） =====
    var AI_BASE = 'http://localhost:8001';
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
    var prefOtherToggle = document.getElementById('pref-other-toggle');
    var prefOtherInput = document.getElementById('pref-other-input');

    // "重新偏航" → 回到开始屏，重置全部状态
    function resetToStart() {
        // 隐藏所有非开始视图
        if (viewExplore) viewExplore.hidden = true;
        if (viewPref) viewPref.hidden = true;
        if (viewDest) viewDest.hidden = true;
        var vr = document.getElementById('view-routes');
        if (vr) vr.hidden = true;
        // 退出导航模式
        document.body.classList.remove('nav-mode');
        var bar = document.getElementById('nav-bar');
        if (bar) bar.hidden = true;
        // 清理地图图层
        if (routeLayer) routeLayer.clearLayers();
        if (poiLayer && map) map.removeLayer(poiLayer);
        // 清理选点状态
        pickingWhich = null;
        if (pickMarker && map) { map.removeLayer(pickMarker); pickMarker = null; }
        var pt = document.getElementById('pick-tip');
        if (pt) pt.hidden = true;
        // 重置状态
        selectedMinutes = null;
        selectedMode = 'walk';
        selectedPlaceTypes = [];
        hasDestination = false;
        startCoords = null;
        endCoords = null;
        lastCandidates = null;
        lastPref = null;
        currentWeather = null;
        enteredExplore = false;
        // 重置UI
        selectedMinutes = null;
        timePresets.forEach(function (el) { el.classList.remove('active'); });
        if (timePickBtn) { timePickBtn.textContent = '自选'; timePickBtn.classList.remove('active'); }
        if (timeChosenEl) timeChosenEl.hidden = true;
        prefModeBtns.forEach(function (b) { b.classList.remove('active'); });
        var defaultMode = document.querySelector('.pref-mode[data-mode="walk"]');
        if (defaultMode) defaultMode.classList.add('active');
        prefTagBtns.forEach(function (b) { b.classList.remove('active'); });
        if (prefOtherToggle) prefOtherToggle.classList.remove('active');
        if (prefOtherInput) { prefOtherInput.value = ''; prefOtherInput.hidden = true; }
        // 重置起终点选点显示
        var startPickEl = document.getElementById('start-pick-btn');
        var endPickEl = document.getElementById('end-pick-btn');
        if (startPickEl) { startPickEl.textContent = '🗺️ 在地图上点选起点'; startPickEl.classList.remove('picking'); }
        if (endPickEl) { endPickEl.textContent = '🗺️ 在地图上点选终点'; endPickEl.classList.remove('picking'); }
        var scEl = document.getElementById('start-coord');
        var ecEl = document.getElementById('end-coord');
        if (scEl) scEl.textContent = '尚未选择（默认使用当前位置）';
        if (ecEl) ecEl.textContent = '尚未选择终点';
        var rb = document.getElementById('route-block');
        if (rb) rb.hidden = true;
        // 显示开始屏
        if (viewStart) viewStart.hidden = false;
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
        });
    });
    if (prefOtherToggle) {
        prefOtherToggle.addEventListener('click', function () {
            var on = prefOtherToggle.classList.toggle('active');
            if (prefOtherInput) prefOtherInput.hidden = !on;
        });
    }

    // "重新偏航"按钮 → 回到开始屏
    if (prefOpenBtn) prefOpenBtn.addEventListener('click', resetToStart);
    // "生成偏航路线" → 进入探索屏 + 生成路线
    if (prefConfirmBtn) prefConfirmBtn.addEventListener('click', enterExploreFromPref);

    // ===== 起点终点：地图选点（长按钮） =====
    var startPickBtn = document.getElementById('start-pick-btn');
    var endPickBtn = document.getElementById('end-pick-btn');
    var startCoordEl = document.getElementById('start-coord');
    var endCoordEl = document.getElementById('end-coord');
    var pickTipEl = document.getElementById('pick-tip');
    var pickingWhich = null; // 'start' | 'end' | null 地图选点目标
    var pickMarker = null;   // 选点临时标记

    // 统一记录坐标 + 更新选点显示
    function fillCoord(isStart, coord) {
        var text = '已选：' + coord.lat.toFixed(5) + ', ' + coord.lng.toFixed(5);
        if (isStart) {
            startCoords = { lat: coord.lat, lng: coord.lng };
            if (startCoordEl) startCoordEl.textContent = text;
            if (startPickBtn) startPickBtn.textContent = '🗺️ 重新点选起点';
        } else {
            endCoords = { lat: coord.lat, lng: coord.lng };
            if (endCoordEl) endCoordEl.textContent = text;
            if (endPickBtn) endPickBtn.textContent = '🗺️ 重新点选终点';
        }
    }

    // 地图选点：切换到地图视图，点击地图取坐标回填
    function startPickPoint(which) {
        if (pickingWhich) return; // 已在选点中
        pickingWhich = which;
        var btn = (which === 'start') ? startPickBtn : endPickBtn;
        if (btn) btn.classList.add('picking');
        // 隐藏偏好视图，显示探索屏(地图)
        if (viewPref) viewPref.hidden = true;
        if (viewExplore) viewExplore.hidden = false;
        if (prefSection) prefSection.hidden = true; // 隐藏"重新偏航"按钮
        if (pickTipEl) pickTipEl.hidden = false;
        if (map) setTimeout(function () { map.invalidateSize(); }, 200);
    }
    function cancelPickPoint() {
        if (!pickingWhich) return;
        var btn = (pickingWhich === 'start') ? startPickBtn : endPickBtn;
        if (btn) btn.classList.remove('picking');
        if (pickTipEl) pickTipEl.hidden = true;
        if (prefSection) prefSection.hidden = false;
        if (pickMarker && map) { map.removeLayer(pickMarker); pickMarker = null; }
        // 回到偏好视图
        if (viewExplore) viewExplore.hidden = true;
        if (viewPref) viewPref.hidden = false;
        if (map) setTimeout(function () { map.invalidateSize(); }, 200);
        pickingWhich = null;
    }
    // 地图点击：若处于选点模式则回填坐标（点击坐标为GCJ-02，存储时转回WGS-84）
    function handleMapPick(e) {
        if (!pickingWhich) return;
        var g = gcj02ToWgs84(e.latlng.lat, e.latlng.lng);
        var coord = { lat: g.lat, lng: g.lng };
        fillCoord(pickingWhich === 'start', coord);
        // 放置临时标记（直接显示在点击处）
        if (pickMarker) map.removeLayer(pickMarker);
        pickMarker = L.circleMarker([e.latlng.lat, e.latlng.lng], {
            radius: 10, color: '#ffffff', fillColor: '#f59e0b', fillOpacity: 1, weight: 3
        }).bindPopup('<div style="font-size:14px"><b>已选：' + (pickingWhich === 'start' ? '起点' : '终点') + '</b><br>' +
            coord.lat.toFixed(5) + ', ' + coord.lng.toFixed(5) + '</div>').addTo(map);
        cancelPickPoint();
    }
    if (startPickBtn) startPickBtn.addEventListener('click', function () { startPickPoint('start'); });
    if (endPickBtn) endPickBtn.addEventListener('click', function () { startPickPoint('end'); });
    // 地图点击回调（打印WGS-84经纬度 + 选点）
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
            fetchPOIs(lat, lng, radius, function (e, els) { e ? rej(e) : res(elementsToPOIs(els)); });
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
    function buildCandidate(center, waypoints, wText, minutes, mode, startPoint, endPoint) {
        var profile = (MODE_CONFIG[mode] || MODE_CONFIG.walk).profile;
        var start = startPoint || center;
        // 先贪心排序途经点，让路线逐步推进而非折返
        var orderedWp = greedyOrder(start, waypoints, endPoint);
        return fetchRouteP(start.lat, start.lng, orderedWp, profile, endPoint).then(function (route) {
            return aiPost('/api/get_reason', {
                pois: orderedWp.map(function (p) { return { name: p.name, type: p.type }; }),
                weather: wText, minutes: minutes
            }).then(function (r) {
                return { waypoints: orderedWp, route: route, reason: (r && r.text) || '',
                    distance: (route && route.route && route.route.distance) || 0,
                    startPoint: start, endPoint: endPoint || null };
            });
        }).catch(function (err) {
            return { waypoints: orderedWp, route: null, reason: '（路线获取失败：' + err.message + '）', distance: 0,
                startPoint: start, endPoint: endPoint || null, error: err.message };
        });
    }

    // "重新偏航"：偏好解析(先) → [有目的地需已选起终点] → 天气 → POI → 3条候选路线 → 弹窗
    function loadCandidates() {
        if (selectedMinutes === null || !map) return;
        var mc = MODE_CONFIG[selectedMode] || MODE_CONFIG.walk;
        var orig = prefConfirmBtn ? prefConfirmBtn.textContent : '';
        if (prefConfirmBtn) { prefConfirmBtn.textContent = '生成中…'; prefConfirmBtn.disabled = true; }

        // 有目的地：必须已在地图上点选起点和终点；无目的地：起点=地图选点或IP位置兜底
        if (hasDestination) {
            if (!startCoords || !endCoords) {
                if (prefConfirmBtn) { prefConfirmBtn.textContent = orig; prefConfirmBtn.disabled = false; }
                alert('请先在地图上点选起点和终点（点击 🗺️ 按钮）');
                return;
            }
        } else if (!startCoords) {
            startCoords = userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null;
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
            var cc = map.getCenter();
            var cw = gcj02ToWgs84(cc.lat, cc.lng);
            center = { lat: cw.lat, lng: cw.lng };
        }
        var radius = Math.round(radiusByMin(selectedMinutes) * mc.radiusMul);
        if (hasDestination && startCoords && endCoords) {
            var seDist = distanceMeters(startCoords, endCoords);
            radius = Math.max(radius, Math.round(seDist * 0.45));
        }
        console.log('开始生成候选路线: 中心(' + center.lat.toFixed(4) + ',' + center.lng.toFixed(4) + ') 半径' + radius + 'm 方式:' + mc.label +
            (hasDestination ? ' 有目的地' : ''));

        // 1. 先解析偏好(若有自由文本)，用于影响打分；后端不可用时回退默认
        aiPost('/api/parse_pref', { user_text: prefText(), minutes: selectedMinutes })
            .then(function (pref) { lastPref = pref; console.log('偏好解析: ' + JSON.stringify(pref)); })
            .catch(function (err) { console.warn('偏好解析失败，使用默认: ' + err.message); lastPref = null; })
            .then(function () {
                // 2. 天气
                return fetchWeatherP(center.lat, center.lng);
            }).then(function (weather) {
                currentWeather = weather;
                console.log('当前天气: ' + weather.text + ' 场景:' + weather.precip + (weather.extreme ? ('/' + weather.extreme) : ''));
                // 3. POI
                return fetchPOIsP(center.lat, center.lng, radius);
            }).then(function (pois) {
                console.log('已加载 ' + pois.length + ' 个POI');
                drawMarkers(pois);
                var wText = currentWeather ? currentWeather.text : '未知';
                var placePrefs = buildPlacePreferences(selectedPlaceTypes);
                var sp = startCoords || userLocation || center;
                var ep = hasDestination ? endCoords : null;
                var candPromises = [];
                for (var i = 0; i < 3; i++) {
                    candPromises.push(buildCandidate(
                        center,
                        selectWaypoints(center, pois, selectedMinutes, lastPref, selectedMode, placePrefs),
                        wText, selectedMinutes, selectedMode, sp, ep
                    ));
                }
                return Promise.all(candPromises);
            }).then(function (candidates) {
                lastCandidates = candidates;
                showRoutesModal({ candidates: lastCandidates, pref: lastPref, weather: currentWeather, minutes: selectedMinutes, mode: mc.label, backendMode: backendMode });
            }).catch(function (err) {
                console.error('生成候选路线失败', err);
                var rb = document.getElementById('routes-body');
                if (rb) rb.innerHTML = '<div class="routes-loading">生成失败：' + err.message + '<br><button type="button" id="retry-btn" class="pref-confirm-btn" style="margin-top:16px">返回重试</button></div>';
                var retry = document.getElementById('retry-btn');
                if (retry) retry.addEventListener('click', closeRoutesView);
            }).then(function () {
                if (prefConfirmBtn) { prefConfirmBtn.textContent = orig; prefConfirmBtn.disabled = false; }
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

    // 弹窗：3条候选路线，每条含理由 + 地点箭头串联 + 选择按钮
    function showRoutesModal(data) {
        var body = document.getElementById('routes-body');
        if (!body) return;
        var pref = data.pref || {};
        var modeLabel = (data.mode || '步行');
        var html = '';
        html += '<div class="ai-block"><div class="ai-block-title">已解析你的偏好</div><div class="ai-tags">';
        html += '<span class="ai-tag">时长 ' + cnLabel(CN_TIME, pref.time_level) + '</span>';
        html += '<span class="ai-tag">' + cnLabel(CN_WALK, pref.walk_intensity) + '</span>';
        html += '<span class="ai-tag">小众度 ' + Math.round((pref.novelty != null ? pref.novelty : 0.5) * 100) + '%</span>';
        html += '<span class="ai-tag">走巷度 ' + Math.round((pref.minor_level != null ? pref.minor_level : 0.5) * 100) + '%</span>';
        html += '</div></div>';
        html += '<div class="ai-block"><div class="ai-block-title">推荐 3 条偏航路线</div>';
        (data.candidates || []).forEach(function (c, i) {
            var names = c.waypoints.map(function (p) { return p.name; });
            var distStr = c.distance ? (' · ' + (c.distance / 1000).toFixed(2) + ' km') : '';
            html += '<div class="route-card">';
            html += '<div class="route-head"><span class="route-num">路线 ' + (i + 1) + '</span><span class="route-meta">' + c.waypoints.length + ' 站' + distStr + '</span></div>';
            html += '<p class="route-reason">' + (c.reason || '') + '</p>';
            html += '<div class="route-path">' + names.join(' <span class="route-arrow">→</span> ') + '</div>';
            html += '<button type="button" class="route-select" data-route="' + i + '">选择此路线</button>';
            html += '</div>';
        });
        html += '<div class="ai-foot">当前' + (data.weather ? data.weather.text : '未知') + ' · 约' + data.minutes + '分钟 · ' + modeLabel + ' · ' + (data.backendMode || 'AI模式') + '</div>';
        html += '</div>';
        body.innerHTML = html;
        var btns = body.querySelectorAll('.route-select');
        Array.prototype.forEach.call(btns, function (b) {
            b.addEventListener('click', function () { selectRoute(parseInt(b.dataset.route, 10)); });
        });
    }

    // 关闭推荐视图 → 回到偏好视图
    function closeRoutesView() {
        var vr = document.getElementById('view-routes');
        if (vr) vr.hidden = true;
        if (viewPref) viewPref.hidden = false;
    }

    // 选中某条路线 → 隐藏推荐视图 → 显示探索屏 → 进入导航 → 绘制路线
    function selectRoute(i) {
        var c = lastCandidates && lastCandidates[i];
        if (!c) return;
        var vr = document.getElementById('view-routes');
        if (vr) vr.hidden = true;
        if (viewExplore) viewExplore.hidden = false;
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
        L.marker(toMapLatLng(startPoint.lat, startPoint.lng), { icon: startIcon })
            .bindPopup('<div style="font-size:14px"><b>起点</b></div>').addTo(routeLayer);
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
            L.marker(toMapLatLng(c.endPoint.lat, c.endPoint.lng), { icon: endIcon })
                .bindPopup('<div style="font-size:14px"><b>终点</b></div>').addTo(routeLayer);
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
    function enterNav(c) {
        document.body.classList.add('nav-mode');
        if (prefSection) prefSection.hidden = true;
        // 导航时只显示路线，隐藏所有POI标记，界面更清爽
        if (poiLayer && map) map.removeLayer(poiLayer);
        var bar = document.getElementById('nav-bar');
        if (!bar) return;
        var distStr = c.distance ? ((c.distance / 1000).toFixed(2) + ' km') : '';
        var names = c.waypoints.map(function (p) { return p.name; });
        var mc = MODE_CONFIG[selectedMode] || MODE_CONFIG.walk;
        bar.innerHTML = '<div class="nav-info"><span class="nav-title">偏航导航中</span>' +
            '<span class="nav-route">' + names.join(' → ') + '</span></div>' +
            '<div class="nav-meta">' + c.waypoints.length + '站 · ' + distStr + ' · ' + mc.label + ' · 约' + selectedMinutes + '分钟</div>' +
            '<button type="button" id="nav-end" class="nav-end">结束偏航</button>';
        bar.hidden = false;
        var endBtn = document.getElementById('nav-end');
        if (endBtn) endBtn.addEventListener('click', exitNav);
    }

    function exitNav() {
        document.body.classList.remove('nav-mode');
        var bar = document.getElementById('nav-bar');
        if (bar) bar.hidden = true;
        if (prefSection) prefSection.hidden = false;
        // 退出导航时恢复POI标记
        if (poiLayer && map) poiLayer.addTo(map);
        if (routeLayer) routeLayer.clearLayers();
        setTimeout(function () { if (map) map.invalidateSize(); }, 200);
    }

    // Overpass 公共端点列表(主端点易限流/中断，依次回退)
    var OVERPASS_ENDPOINTS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    // 调用Overpass公开免费接口获取POI(多端点回退 + 单端点25s超时)
    function fetchPOIs(lat, lng, radius, cb) {
        var query = buildOverpassQuery(lat, lng, radius);
        var body = 'data=' + encodeURIComponent(query);
        var idx = 0;
        function tryNext(prevErr) {
            if (idx >= OVERPASS_ENDPOINTS.length) {
                cb(prevErr || new Error('全部Overpass端点失败'));
                return;
            }
            var url = OVERPASS_ENDPOINTS[idx++];
            var controller = new AbortController();
            var timer = setTimeout(function () { controller.abort(); }, 25000);
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
                cb(null, (data && data.elements) || []);
            }).catch(function (err) {
                clearTimeout(timer);
                console.warn('Overpass端点失败 ' + url + ': ' + err.message);
                tryNext(err);
            });
        }
        tryNext(null);
    }

    startBtn.addEventListener('click', showDestQuestion);
    if (destYes) destYes.addEventListener('click', function () { enterPrefView(true); });
    if (destNo) destNo.addEventListener('click', function () { enterPrefView(false); });

    // 推荐视图返回按钮 → 回到偏好视图
    var routesCloseBtn = document.getElementById('routes-close');
    if (routesCloseBtn) routesCloseBtn.addEventListener('click', closeRoutesView);

    updateStartButton();
})();
