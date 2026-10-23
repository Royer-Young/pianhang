// 偏航 Web App · 应用外壳
// 负责：侧边栏折叠 / 移动端抽屉 / Hash 路由 / 开屏与页面切换动画
// 不参与偏航业务流程，业务流程仍由 app.js 处理。

(function () {
    'use strict';

    // ===== 演示动画时长（毫秒），可按现场演示节奏调整 =====
    var SPLASH_MS = 2600;      // 开屏罗盘动画停留时间
    var VEIL_SWAP_MS = 700;    // 切换遮罩铺满后、真正切换页面的时间
    var VEIL_MIN_MS = 1250;    // 切换遮罩最短展示时间
    var MOBILE_BREAKPOINT = 900;

    var ROUTES = {
        home:         { title: '开始偏航', veil: '正在校准你的方向…' },
        footprints:   { title: '我的足迹', veil: '正在翻开你的足迹…' },
        favorites:    { title: '我的收藏', veil: '正在整理你的城市碎片…' },
        history:      { title: '偏航记录', veil: '正在回放每一次出发…' },
        achievements: { title: '我的成就', veil: '正在点亮你的徽章…' },
        settings:     { title: '偏好设置', veil: '正在读取你的偏好…' },
        profile:      { title: '个人中心', veil: '正在打开你的偏航档案…' },
        about:        { title: '关于偏航', veil: '正在加载关于偏航…' }
    };

    // ===== 每个页面的夜景底图（局部文件，构建时会一并复制） =====
    var PAGE_BG = {
        home:         { src: 'assets/bg/tokyo-night.webp',      pos: 'center 44%', opacity: 0.48, filter: 'blur(3.5px) saturate(1) brightness(1.05)' },
        footprints:   { src: 'assets/bg/la-night.webp',         pos: 'center 58%', opacity: 0.3,  filter: 'blur(3.5px) saturate(.78) brightness(.8)' },
        favorites:    { src: 'assets/bg/library.webp',          pos: 'center 42%', opacity: 0.28, filter: 'blur(3.5px) sepia(.12) saturate(.85) brightness(.82)' },
        history:      { src: 'assets/bg/bridge-trails.webp',    pos: 'center 50%', opacity: 0.32, filter: 'blur(3.5px) saturate(.9) brightness(.86)' },
        achievements: { src: 'assets/bg/hongkong-night.webp',   pos: 'center 35%', opacity: 0.34, filter: 'blur(3.5px) saturate(.86) brightness(.86)' },
        settings:     { src: 'assets/bg/melbourne-night.webp',  pos: 'center 55%', opacity: 0.36, filter: 'blur(3.5px) saturate(.82) brightness(.86)' },
        profile:      { src: 'assets/bg/tokyo-dusk.webp',       pos: 'center 45%', opacity: 0.34, filter: 'blur(3.5px) saturate(.86) brightness(.86)' },
        about:        { src: 'assets/bg/earth-night.webp',      pos: 'center 40%', opacity: 0.42, filter: 'blur(3.5px) saturate(.95) brightness(1)' }
    };

    var body = document.body;
    var sidebar = document.getElementById('sidebar');
    var collapseBtn = document.getElementById('sidebar-collapse');
    var drawerToggle = document.getElementById('drawer-toggle');
    var backdrop = document.getElementById('drawer-backdrop');
    var bootScreen = document.getElementById('boot-screen');
    var veil = document.getElementById('route-veil');
    var veilText = document.getElementById('veil-text');
    var mobileTitle = document.getElementById('mobile-title');
    var bgLayerA = document.getElementById('bg-layer-a');
    var bgLayerB = document.getElementById('bg-layer-b');
    var routeLights = document.getElementById('route-lights');

    var bgActiveLayer = null;
    var bgActiveRoute = null;
    var bgPrefetched = {};

    var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
    var navItems = Array.prototype.slice.call(document.querySelectorAll('.nav-item'));
    var profileCard = document.getElementById('profile-card');

    var currentRoute = null;
    var transitionToken = 0;
    var veilHideTimer = null;

    // ===== 页面背景：两张图交叉淡入，旧图缓慢退场 =====
    function setBackground(route) {
        var cfg = PAGE_BG[route] || PAGE_BG.home;

        body.setAttribute('data-route', route);

        if (routeLights) {
            routeLights.classList.toggle('is-soft', route === 'home' || route === 'history');
            routeLights.classList.toggle('is-strong', route === 'footprints');
        }

        if (!bgLayerA || !bgLayerB) return;
        if (bgActiveRoute === route && bgActiveLayer) return;

        var next = bgActiveLayer === bgLayerA ? bgLayerB : bgLayerA;
        var prev = bgActiveLayer;

        next.style.backgroundImage = 'url("' + cfg.src + '")';
        next.style.backgroundPosition = cfg.pos || 'center';
        next.style.filter = cfg.filter || 'none';
        next.style.setProperty('--bg-opacity', String(cfg.opacity));

        // 重新触发 Ken Burns 动画与透明度过渡
        next.classList.remove('active');
        void next.offsetWidth;
        next.classList.add('active');

        if (prev && prev !== next) prev.classList.remove('active');

        bgActiveLayer = next;
        bgActiveRoute = route;

        bgPrefetched[cfg.src] = true;
    }

    function prefetchBackgrounds() {
        Object.keys(PAGE_BG).forEach(function (key) {
            var cfg = PAGE_BG[key];
            if (!cfg || !cfg.src || bgPrefetched[cfg.src]) return;
            bgPrefetched[cfg.src] = true;
            var img = new Image();
            img.src = cfg.src;
        });
    }

    // ===== 路由 =====
    function parseRoute() {
        var raw = (location.hash || '').replace(/^#\/?/, '').trim();
        if (!raw) return 'home';
        var name = raw.split('/')[0].split('?')[0];
        return ROUTES[name] ? name : 'home';
    }

    function setActiveNav(route) {
        navItems.forEach(function (item) {
            var on = item.getAttribute('data-route') === route;
            item.classList.toggle('active', on);
            if (on) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        if (profileCard) profileCard.classList.toggle('active', route === 'profile');
    }

    function applyRoute(route, animate) {
        currentRoute = route;

        pages.forEach(function (page) {
            var on = page.getAttribute('data-page') === route;
            page.hidden = !on;
            page.classList.remove('page-enter');
            if (on && animate) {
                // 强制重排，确保动画可以重复触发
                void page.offsetWidth;
                page.classList.add('page-enter');
            }
        });

        setActiveNav(route);
        setBackground(route);

        var meta = ROUTES[route] || ROUTES.home;
        if (mobileTitle) mobileTitle.textContent = meta.title;
        document.title = route === 'home'
            ? '偏航 · 偏离最短路径，遇见意外风景'
            : meta.title + ' · 偏航';

        window.scrollTo(0, 0);
        closeDrawer();

        // 首页重新显示时，通知 Leaflet 重算容器尺寸
        if (route === 'home') {
            setTimeout(function () {
                window.dispatchEvent(new Event('resize'));
            }, 80);
        }
    }

    function showVeil(text) {
        if (!veil) return;
        if (veilHideTimer) {
            clearTimeout(veilHideTimer);
            veilHideTimer = null;
        }
        if (veilText) veilText.textContent = text || '正在校准你的方向…';
        veil.hidden = false;
        requestAnimationFrame(function () {
            veil.classList.add('visible');
        });
    }

    function hideVeil() {
        if (!veil) return;
        veil.classList.remove('visible');
        if (veilHideTimer) clearTimeout(veilHideTimer);
        veilHideTimer = setTimeout(function () {
            veil.hidden = true;
            veilHideTimer = null;
        }, 340);
    }

    function navigateTo(route, options) {
        options = options || {};

        if (route === currentRoute && !options.force) {
            closeDrawer();
            return;
        }

        var token = ++transitionToken;
        var meta = ROUTES[route] || ROUTES.home;

        showVeil(meta.veil);

        setTimeout(function () {
            if (token !== transitionToken) return;
            applyRoute(route, true);

            setTimeout(function () {
                if (token !== transitionToken) return;
                hideVeil();
            }, Math.max(0, VEIL_MIN_MS - VEIL_SWAP_MS));
        }, VEIL_SWAP_MS);
    }

    window.addEventListener('hashchange', function () {
        navigateTo(parseRoute());
    });

    // 首次进入：直接应用当前 hash，不额外显示切换遮罩（开屏动画会覆盖）
    applyRoute(parseRoute(), false);

    // ===== 侧边栏折叠（桌面端） =====
    var COLLAPSE_KEY = 'ph_sidebar_collapsed';

    try {
        if (localStorage.getItem(COLLAPSE_KEY) === '1' && sidebar) {
            sidebar.classList.add('collapsed');
        }
    } catch (e) { /* 隐私模式下忽略 */ }

    function syncCollapseButton() {
        if (!collapseBtn || !sidebar) return;
        var collapsed = sidebar.classList.contains('collapsed');
        collapseBtn.textContent = collapsed ? '»' : '«';
        collapseBtn.setAttribute('aria-label', collapsed ? '展开侧边栏' : '折叠侧边栏');
        collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    syncCollapseButton();

    if (collapseBtn && sidebar) {
        collapseBtn.addEventListener('click', function () {
            sidebar.classList.toggle('collapsed');
            syncCollapseButton();
            try {
                localStorage.setItem(COLLAPSE_KEY, sidebar.classList.contains('collapsed') ? '1' : '0');
            } catch (e) { /* 忽略 */ }
        });
    }

    // ===== 移动端抽屉 =====
    function openDrawer() {
        body.classList.add('drawer-open');
        if (backdrop) backdrop.hidden = false;
        if (drawerToggle) drawerToggle.setAttribute('aria-expanded', 'true');
    }

    function closeDrawer() {
        body.classList.remove('drawer-open');
        if (backdrop) backdrop.hidden = true;
        if (drawerToggle) drawerToggle.setAttribute('aria-expanded', 'false');
    }

    if (drawerToggle) drawerToggle.addEventListener('click', openDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDrawer();
    });

    window.addEventListener('resize', function () {
        if (window.innerWidth > MOBILE_BREAKPOINT) closeDrawer();
    });

    // 点击侧边栏内任意导航链接后关闭抽屉
    if (sidebar) {
        sidebar.addEventListener('click', function (e) {
            var link = e.target.closest ? e.target.closest('a[href^="#/"]') : null;
            if (link) closeDrawer();
        });
    }

    // ===== 开屏动画 =====
    var bootHidden = false;

    function hideBoot() {
        if (bootHidden || !bootScreen) return;
        bootHidden = true;
        bootScreen.classList.add('leaving');
        body.classList.remove('booting');
        setTimeout(function () {
            bootScreen.hidden = true;
        }, 520);
    }

    if (bootScreen) {
        bootScreen.addEventListener('click', hideBoot);

        var skipBtn = document.getElementById('boot-skip');
        if (skipBtn) {
            skipBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                hideBoot();
            });
        }

        var bootTimerStarted = false;
        function startBootTimer() {
            if (bootTimerStarted) return;
            bootTimerStarted = true;
            setTimeout(hideBoot, SPLASH_MS);
        }

        // 资源加载完成后再完整展示动画；最多再等 1.2s，避免慢网络下卡住
        if (document.readyState === 'complete') startBootTimer();
        else window.addEventListener('load', startBootTimer);
        setTimeout(startBootTimer, 1200);
    }

    // ===== 空闲时预取其余页面底图，切页时不至于空白 =====
    setTimeout(prefetchBackgrounds, 2800);
})();
