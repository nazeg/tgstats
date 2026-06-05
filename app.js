// ==========================================================================
// STATE MANAGEMENT & CONSTANTS
// ==========================================================================

// Haftanın Yıldızları podiumunda gözükmesin istenen kullanıcı adları
const PODIUM_EXCLUDED_USERNAMES = ['nazmiegret', 'keremalper', 'cagdasca'];

const STATE = {
    apiUrl: (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'https://tg.chargetr.com',
    isDemoMode: false,
    users: [],
    messages: [],
    vehicles: [],
    reactions: [],
    levels: [],
    filteredUsers: [],
    liveMemberCount: null,
    activeVehicles: [],
    cityCounts: {},
    totalWithCity: 0,
    totalLiveMessages: 0,
    allMessages: [],
    allReactions: [],
    charts: {
        activity: null,
        vehicles: null
    }
};

// ==========================================================================
// CORE APP INITIALIZATION
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Load Saved URL from LocalStorage if set
    let savedUrl = localStorage.getItem('api_url') || localStorage.getItem('pocketbase_url');
    if (savedUrl) {
        savedUrl = savedUrl.replace(/\/_\/?$/, '').replace(/\/$/, '');
        STATE.apiUrl = savedUrl;
    }

    // Initialize Event Listeners
    initTabs();
    initEventListeners();
    initMobileMenu();

    // Deep-link: activate tab from URL hash (e.g. #kvkk)
    const hash = window.location.hash;
    if (hash) {
        const targetTab = document.querySelector(`.sidebar-menu a[href="${hash}"]`);
        if (targetTab) targetTab.click();
    }

    // Fetch initial data
    loadDashboardData();
});

// Tab Navigation Logic
function initTabs() {
    const tabs = document.querySelectorAll('.sidebar-menu a');
    const panes = document.querySelectorAll('.tab-pane');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();

            // Remove active classes
            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            // Add active class to clicked tab
            tab.classList.add('active');

            // Show corresponding pane
            const paneId = tab.getAttribute('href').replace('#', 'pane-');
            const targetPane = document.getElementById(paneId);
            if (targetPane) {
                targetPane.classList.add('active');
            }

            // Update Page Header Titles
            const titleElement = document.getElementById('page-title');
            const subtitleElement = document.getElementById('page-subtitle');

            switch (tab.getAttribute('href')) {
                case '#overview':
                    titleElement.textContent = 'Genel Bakış';
                    subtitleElement.textContent = 'Topluluk verileri ve istatistik analizi';
                    break;
                case '#leaderboard':
                    titleElement.textContent = 'Liderlik Tablosu';
                    subtitleElement.textContent = 'En aktif üyeler ve puan sıralamaları';
                    break;
                case '#vehicles':
                    titleElement.textContent = 'Araç Dağılımı';
                    subtitleElement.textContent = 'Topluluk üyelerinin araç model tercihleri';
                    break;
                case '#kvkk':
                    titleElement.textContent = 'KVKK Aydınlatma';
                    subtitleElement.textContent = 'Kişisel verilerin korunması hakkında bilgilendirme';
                    break;

            }

            // Re-render charts on tab switch to resolve size issues
            if (tab.getAttribute('href') === '#overview') {
                renderCharts();
            }
        });
    });
}

function initEventListeners() {

    // Leaderboard Search Filter (Debounced)
    document.getElementById('leaderboard-search').addEventListener('input', debounceApplyFilters);

    // Leaderboard Dropdown Filters
    document.getElementById('filter-level').addEventListener('change', applyFilters);
    document.getElementById('filter-vehicle').addEventListener('change', applyFilters);
    document.getElementById('filter-city').addEventListener('change', applyFilters);



    // Modal Details Box Close Event
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('user-detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'user-detail-modal') {
            closeModal();
        }
    });
}

// ==========================================================================
// DATA LOADING & SYNCING
// ==========================================================================

async function loadDashboardData() {
    showOverlayNotification("Veriler yükleniyor...", false);

    try {
        // Try fetching from real server instance
        const status = await testConnection();

        if (status) {
            console.log("Connection active. Fetching database...");
            STATE.isDemoMode = false;
            updateConnectionIndicator(true);
            removeDemoBanner();

            // Parallel fetches for efficiency
            const [usersData, vehiclesData, levelsData, messagesData, reactionsData, statsData, cityStats, weeklyActivity] = await Promise.all([
                fetchCollection('users', { sort: '-points', expand: 'level,vehicle', perPage: 100 }),
                fetchCollection('vehicles', { perPage: 100 }),
                fetchCollection('levels', { perPage: 100 }),
                fetchCollection('messages', { sort: '-created', perPage: 1 }),
                fetchCollection('reactions', { sort: '-created', perPage: 1 }),
                fetchCollection('statistics', { perPage: 1 }).catch(() => ({ items: [] })),
                fetchAllCityStats().catch(() => ({ cityCounts: {}, totalWithCity: 0 })),
                fetchAllWeeklyActivity().catch(() => ({ messages: [], reactions: [] }))
            ]);

            STATE.levels = levelsData.items || [];
            STATE.vehicles = vehiclesData.items || [];
            STATE.messages = weeklyActivity.messages || [];
            STATE.allMessages = weeklyActivity.messages || [];
            STATE.allReactions = weeklyActivity.reactions || [];
            STATE.totalLiveMessages = messagesData.totalItems || 0;
            STATE.reactions = weeklyActivity.reactions || [];
            STATE.liveMemberCount = statsData?.items?.[0]?.member_count || null;
            STATE.cityCounts = cityStats.cityCounts || {};
            STATE.totalWithCity = cityStats.totalWithCity || 0;

            // Format users expand mapping correctly and assign preloaded ranks
            STATE.users = (usersData.items || []).map((user, index) => {
                let vObj = null;
                if (user.expand?.vehicle) {
                    vObj = user.expand.vehicle;
                } else if (user.vehicle) {
                    const vehicleIds = Array.isArray(user.vehicle) ? user.vehicle : [user.vehicle];
                    const matched = STATE.vehicles.filter(v => vehicleIds.includes(v.id));
                    vObj = Array.isArray(user.vehicle) ? matched : matched[0] || null;
                }
                return {
                    ...user,
                    overallRank: index + 1,
                    levelObj: user.expand?.level || STATE.levels.find(l => l.id === user.level),
                    vehicleObj: vObj
                };
            });
        } else {
            throw new Error("Cannot connect to server");
        }
    } catch (error) {
        console.error("Connection failed:", error);
        STATE.isDemoMode = false;
        STATE.levels = [];
        STATE.vehicles = [];
        STATE.users = [];
        STATE.messages = [];
        STATE.reactions = [];
        STATE.liveMemberCount = null;
        STATE.cityCounts = {};
        STATE.totalWithCity = 0;
        STATE.totalLiveMessages = 0;
        STATE.allMessages = [];
        STATE.allReactions = [];
        updateConnectionIndicator(false);
        showDemoBanner();
    }

    // Process and display data
    STATE.filteredUsers = [...STATE.users];

    await populateFilterDropdowns();
    updateKpis();
    await renderPodium();
    renderLeaderboard();
    renderVehicleStats();
    renderCharts();
    renderCityStats();

    hideOverlayNotification();
}

async function testConnection() {
    try {
        const res = await fetch(`${STATE.apiUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function fetchCollection(collection, params = {}) {
    const url = new URL(`${STATE.apiUrl}/api/collections/${collection}/records`);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Fetch failed for collection: ${collection}`);
    return await res.json();
}

async function fetchAllCityStats() {
    let page = 1;
    const cityCounts = {};
    let totalWithCity = 0;
    while (true) {
        const res = await fetchCollection('users', {
            filter: "city != ''",
            fields: 'city',
            perPage: 500,
            page: page
        });
        const items = res.items || [];
        if (items.length === 0) break;
        items.forEach(u => {
            if (u.city) {
                cityCounts[u.city] = (cityCounts[u.city] || 0) + 1;
                totalWithCity++;
            }
        });
        if (page >= res.totalPages) break;
        page++;
    }
    return { cityCounts, totalWithCity };
}

async function fetchAllWeeklyActivity() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const filterDate = sevenDaysAgo.toISOString().replace('T', ' ').split('.')[0];

    async function fetchAllPages(collection, extraFilter) {
        let page = 1;
        let allItems = [];
        const filter = `created >= '${filterDate}'` + (extraFilter ? ` && ${extraFilter}` : '');
        while (true) {
            const res = await fetchCollection(collection, {
                filter: filter,
                fields: 'id,created,telegram_user,target_user',
                sort: '-created',
                perPage: 500,
                page: page
            });
            const items = res.items || [];
            allItems = allItems.concat(items);
            if (items.length === 0 || page >= res.totalPages) break;
            page++;
        }
        return allItems;
    }

    const [messages, reactions] = await Promise.all([
        fetchAllPages('messages'),
        fetchAllPages('reactions')
    ]);

    return { messages, reactions };
}

// UI Helpers
function updateConnectionIndicator(isConnected) {
    const indicator = document.getElementById('connection-status-indicator');
    const text = document.getElementById('connection-status-text');

    if (isConnected) {
        indicator.className = 'connection-status connected';
        text.textContent = 'Bağlantı Aktif';
    } else {
        indicator.className = 'connection-status disconnected';
        text.textContent = 'Bağlantı Hatası';
    }
}

function showDemoBanner() {
    if (document.getElementById('demo-warning-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'demo-warning-banner';
    banner.className = 'demo-banner';
    banner.innerHTML = `
        <div class="demo-banner-content">
            <i data-lucide="alert-triangle"></i>
            <span><strong>Bağlantı Hatası:</strong> Sunucu bağlantısı kurulamadı. Lütfen ağınızı veya sunucu ayarlarını kontrol edin.</span>
        </div>
    `;
    document.body.prepend(banner);
    lucide.createIcons();

    // Add banner CSS dynamic styling to body/layout
    document.documentElement.style.setProperty('--banner-offset', '50px');
    document.body.style.paddingTop = '50px';
}

function removeDemoBanner() {
    const banner = document.getElementById('demo-warning-banner');
    if (banner) banner.remove();
    document.body.style.paddingTop = '0px';
    document.documentElement.style.setProperty('--banner-offset', '0px');
}

// Overlay loaders
let overlayTimeout;
function showOverlayNotification(text, isError = false) {
    // Basic text output on status
}

function hideOverlayNotification() {
    // Clear loader status
}

// ==========================================================================
// RENDERERS & DATA MANIPULATION
// ==========================================================================

async function populateFilterDropdowns() {
    const levelSelect = document.getElementById('filter-level');
    const vehicleSelect = document.getElementById('filter-vehicle');
    const citySelect = document.getElementById('filter-city');

    // Clear dynamic options, keep first empty option
    levelSelect.innerHTML = '<option value="">Tüm Seviyeler</option>';
    vehicleSelect.innerHTML = '<option value="">Tüm Araçlar</option>';
    citySelect.innerHTML = '<option value="">Tüm Şehirler</option>';

    STATE.levels.forEach(lvl => {
        const opt = document.createElement('option');
        opt.value = lvl.id;
        opt.textContent = `${lvl.badge || ''} ${lvl.name}`;
        levelSelect.appendChild(opt);
    });

    // Only populate vehicles that are chosen/selected by at least one user in the database
    const checks = await Promise.all(STATE.vehicles.map(async (veh) => {
        try {
            const res = await fetchCollection('users', {
                filter: `vehicle ~ '${veh.id}'`,
                perPage: 1
            });
            return { veh: { ...veh, ownerCount: res.totalItems }, hasUsers: res.totalItems > 0 };
        } catch (e) {
            console.error(`Error checking vehicle ${veh.id}:`, e);
            return { veh: { ...veh, ownerCount: 0 }, hasUsers: false };
        }
    }));

    STATE.activeVehicles = checks.filter(c => c.hasUsers).map(c => c.veh);
    STATE.activeVehicles.sort((a, b) => b.ownerCount - a.ownerCount);

    STATE.activeVehicles.forEach(veh => {
        const opt = document.createElement('option');
        opt.value = veh.id;
        opt.textContent = `${veh.brand} ${veh.model} (${veh.ownerCount})`;
        vehicleSelect.appendChild(opt);
    });

    // Populate Unique Cities
    const uniqueCities = Object.keys(STATE.cityCounts || {}).sort();
    uniqueCities.forEach(city => {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = city;
        citySelect.appendChild(opt);
    });
}

function updateKpis() {
    // 1. Total Members
    const totalUsers = STATE.liveMemberCount !== null ? STATE.liveMemberCount : STATE.users.length;
    document.getElementById('kpi-total-users').textContent = totalUsers.toLocaleString('tr-TR');

    // 2. Total Messages (1,000,000 historical messages + live messages)
    const totalMessages = 1400000 + (STATE.totalLiveMessages || STATE.messages.length);
    document.getElementById('kpi-total-messages').textContent = totalMessages.toLocaleString('tr-TR');

    // 4. Most popular vehicles (Top 3) — uses activeVehicles with accurate DB counts
    const sortedVehicles = [...(STATE.activeVehicles || [])]
        .sort((a, b) => b.ownerCount - a.ownerCount)
        .map(v => ({ name: `${v.brand} ${v.model}`, count: v.ownerCount }));

    const listContainer = document.getElementById('kpi-top-vehicles-list');
    listContainer.innerHTML = '';

    if (sortedVehicles.length === 0) {
        listContainer.innerHTML = `
            <div style="font-size: 0.95rem; font-weight: 600; color: hsl(var(--text-muted)); margin-top: 4px;">
                Belirtilmemiş
            </div>
        `;
    } else {
        const top3 = sortedVehicles.slice(0, 3);
        top3.forEach((veh, idx) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justify = 'space-between';
            item.style.alignItems = 'center';
            item.style.fontSize = '0.9rem';
            item.style.fontWeight = '700';
            item.style.width = '100%';
            item.style.color = 'hsl(var(--text-primary))';

            item.innerHTML = `
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                    ${idx + 1}. ${veh.name}
                </span>
            `;
            listContainer.appendChild(item);
        });
    }

    lucide.createIcons();
}

async function renderPodium() {
    const wrapper = document.getElementById('podium-wrapper');
    wrapper.innerHTML = '<div class="podium-placeholder">Haftalık veriler hesaplanıyor...</div>';

    // Calculate weekly points from ALL messages/reactions (not limited to STATE.users)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyPoints = {};

    // Count messages sent in the last 7 days — all users
    STATE.allMessages.forEach(msg => {
        if (msg.created && msg.telegram_user) {
            const msgDate = new Date(msg.created.replace(' ', 'T'));
            if (msgDate >= oneWeekAgo) {
                weeklyPoints[msg.telegram_user] = (weeklyPoints[msg.telegram_user] || 0) + 1;
            }
        }
    });

    // Count reactions received in the last 7 days — all users
    STATE.allReactions.forEach(react => {
        if (react.created && react.target_user) {
            const reactDate = new Date(react.created.replace(' ', 'T'));
            if (reactDate >= oneWeekAgo) {
                weeklyPoints[react.target_user] = (weeklyPoints[react.target_user] || 0) + 1;
            }
        }
    });

    // Sort all user IDs by weekly points, take top candidates
    const topCandidates = Object.entries(weeklyPoints)
        .filter(([, pts]) => pts > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20); // fetch extra to account for excluded usernames

    if (topCandidates.length === 0) {
        wrapper.innerHTML = '<div class="podium-placeholder">Bu hafta henüz aktif üye bulunmuyor.</div>';
        return;
    }

    // Resolve user details — check STATE.users cache first, fetch missing ones
    const missingIds = topCandidates
        .map(([id]) => id)
        .filter(id => !STATE.users.find(u => u.id === id));

    let fetchedUsers = [];
    if (missingIds.length > 0) {
        try {
            const filterQuery = missingIds.map(id => `id = '${id}'`).join(' || ');
            const res = await fetchCollection('users', {
                filter: filterQuery,
                expand: 'level',
                perPage: 20
            });
            fetchedUsers = res.items || [];
        } catch (e) {
            console.error('Failed to fetch missing podium users:', e);
        }
    }

    // Build enriched user list with weekly points
    const allKnownUsers = [...STATE.users, ...fetchedUsers];
    const usersWithWeeklyPoints = topCandidates.map(([userId, pts]) => {
        const user = allKnownUsers.find(u => u.id === userId);
        if (!user) return null;
        return { ...user, weeklyPoints: pts };
    }).filter(Boolean);

    // Filter out excluded usernames
    const activeSorted = usersWithWeeklyPoints.filter(u =>
        !PODIUM_EXCLUDED_USERNAMES.includes(u.username)
    );

    wrapper.innerHTML = '';

    if (activeSorted.length === 0) {
        wrapper.innerHTML = '<div class="podium-placeholder">Bu hafta henüz aktif üye bulunmuyor.</div>';
        return;
    }

    // Get top 5
    const top5 = activeSorted.slice(0, 5);

    // Podium rendering order: 4th, 2nd, 1st, 3rd, 5th (symmetric podium)
    const order = [];
    if (top5.length >= 4) order.push(3); // 4th
    if (top5.length >= 2) order.push(1); // 2nd
    if (top5.length >= 1) order.push(0); // 1st
    if (top5.length >= 3) order.push(2); // 3rd
    if (top5.length >= 5) order.push(4); // 5th

    // Fallback if only 1 user is active
    if (top5.length === 1) {
        order.length = 0;
        order.push(0);
    }

    order.forEach(idx => {
        const user = top5[idx];
        if (!user) return;

        const rank = idx + 1;
        const colClass = rank === 1 ? 'first' : rank === 2 ? 'second' : rank === 3 ? 'third' : rank === 4 ? 'fourth' : 'fifth';

        const initials = user.first_name ? user.first_name[0].toUpperCase() : 'U';
        const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Anonim';

        const col = document.createElement('div');
        col.className = `podium-column ${colClass}`;

        let avatarContent = `${initials}<div class="podium-badge">${rank}</div>`;
        let avatarStyle = "";
        if (user.avatar) {
            const avatarUrl = `${STATE.apiUrl}/api/files/users/${user.id}/${user.avatar}`;
            avatarContent = `<img src="${avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;"><div class="podium-badge">${rank}</div>`;
            avatarStyle = `style="padding: 0; background: none;"`;
        }

        col.innerHTML = `
            <div class="podium-avatar" ${avatarStyle}>
                ${avatarContent}
            </div>
            <div class="podium-name" title="${displayName}">${displayName}</div>
            <div class="podium-points">${user.weeklyPoints} Puan</div>
            <div class="podium-bar">
                <span class="podium-number">#${rank}</span>
            </div>
        `;

        // Add click listener to open detail modal
        col.addEventListener('click', () => showUserDetail(user.id));
        wrapper.appendChild(col);
    });
}

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboard-tbody');
    tbody.innerHTML = '';

    if (STATE.filteredUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-8 text-muted">
                    Eşleşen kullanıcı bulunamadı.
                </td>
            </tr>
        `;
        return;
    }

    // Sort filtered users by points descending
    const sorted = [...STATE.filteredUsers].sort((a, b) => b.points - a.points);

    sorted.forEach((user) => {
        const rank = user.overallRank || 1;

        let rankHtml = '';
        if (typeof rank === 'number' && rank <= 3) {
            rankHtml = `<span class="rank-badge rank-${rank}">${rank}</span>`;
        } else {
            rankHtml = `<span class="rank-badge rank-other">${rank}</span>`;
        }

        const initials = user.first_name ? user.first_name[0].toUpperCase() : 'U';
        const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Anonim';
        const usernameText = user.username ? `@${user.username}` : '';
        const levelBadge = user.levelObj?.badge || '🔋';
        const levelName = user.levelObj?.name || 'Yeni Üye';

        const sortedLevels = [...STATE.levels].sort((a, b) => a.min_points - b.min_points);
        const levelIndex = sortedLevels.findIndex(l => l.id === user.level);
        const levelClass = levelIndex !== -1 ? `level-idx-${levelIndex}` : '';
        let vehicleText = 'Belirtilmemiş';
        if (user.vehicleObj) {
            const vehicles = Array.isArray(user.vehicleObj) ? user.vehicleObj : [user.vehicleObj];
            if (vehicles.length > 0) {
                vehicleText = vehicles.map(v => `${v.brand} ${v.model}`).join(', ');
            }
        }
        const hasVehicle = user.vehicleObj && (Array.isArray(user.vehicleObj) ? user.vehicleObj.length > 0 : true);
        const vehicleClass = hasVehicle ? 'vehicle-tag' : 'vehicle-tag empty';

        const row = document.createElement('tr');

        let avatarHtml = `<div class="table-user-avatar">${initials}</div>`;
        if (user.avatar) {
            const avatarUrl = `${STATE.apiUrl}/api/files/users/${user.id}/${user.avatar}`;
            avatarHtml = `<img src="${avatarUrl}" class="table-user-avatar" style="object-fit: cover;">`;
        }

        row.innerHTML = `
            <td>${rankHtml}</td>
            <td>
                <div class="table-user-cell">
                    ${avatarHtml}
                    <div class="table-user-details">
                        <span class="table-user-name">${displayName}</span>
                        <span class="table-user-handle">${usernameText}</span>
                    </div>
                </div>
            </td>
            <td>
                <span class="badge-level-cell ${levelClass}">
                    <span>${levelBadge}</span>
                    <span>${levelName}</span>
                </span>
            </td>
            <td>${user.city || 'Belirtilmemiş'}</td>
            <td class="text-right">${user.message_count}</td>
            <td class="text-right">${user.reaction_count}</td>
            <td class="text-right points-highlight">${user.points}</td>
            <td>
                <span class="${vehicleClass}">${vehicleText}</span>
            </td>
            <td class="text-center">
                <button class="btn btn-secondary btn-icon" style="padding: 6px;" onclick="showUserDetail('${user.id}')">
                    <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });

    lucide.createIcons();
}

let filterTimeout;
function debounceApplyFilters() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        applyFilters();
    }, 350);
}

async function applyFilters() {
    const searchVal = document.getElementById('leaderboard-search').value.trim();
    const levelVal = document.getElementById('filter-level').value;
    const vehicleVal = document.getElementById('filter-vehicle').value;
    const cityVal = document.getElementById('filter-city').value;

    // Show searching state in the table body while fetching
    const tbody = document.getElementById('leaderboard-tbody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-8 text-muted">
                    Aranıyor...
                </td>
            </tr>
        `;
    }

    try {
        if (!searchVal && !levelVal && !vehicleVal && !cityVal) {
            // If all filters are empty, show the preloaded top 100 users
            STATE.filteredUsers = [...STATE.users];
            renderLeaderboard();
            return;
        }

        // Build server-side filter query
        let filterRules = [];
        if (searchVal) {
            // Turkish case sensitivity workaround for SQLite/PocketBase
            const toTurkishLowerCase = (str) => str.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
            const toTurkishUpperCase = (str) => str.replace(/ı/g, 'I').replace(/i/g, 'İ').toUpperCase();

            const terms = Array.from(new Set([
                searchVal,
                searchVal.toLowerCase(),
                searchVal.toUpperCase(),
                toTurkishLowerCase(searchVal),
                toTurkishUpperCase(searchVal)
            ]));

            const clauses = [];
            terms.forEach(term => {
                const escaped = term.replace(/'/g, "\\'");
                clauses.push(`first_name ~ '${escaped}' || last_name ~ '${escaped}' || username ~ '${escaped}'`);
            });
            filterRules.push(`(${clauses.join(' || ')})`);
        }
        if (levelVal) {
            filterRules.push(`level = '${levelVal}'`);
        }
        if (vehicleVal) {
            filterRules.push(`vehicle ~ '${vehicleVal}'`);
        }
        if (cityVal) {
            filterRules.push(`city = '${cityVal}'`);
        }

        const filterQuery = filterRules.join(' && ');

        const searchData = await fetchCollection('users', {
            filter: filterQuery,
            expand: 'level,vehicle',
            perPage: 100,
            sort: '-points'
        });

        // Map expand fields correctly and calculate overall rank dynamically
        const top100Users = [...STATE.users];

        const rankedUsers = await Promise.all((searchData.items || []).map(async user => {
            const memRank = top100Users.findIndex(u => u.id === user.id);
            let overallRank = memRank !== -1 ? memRank + 1 : null;

            if (overallRank === null) {
                try {
                    // Count how many users have more points than this user
                    const countData = await fetchCollection('users', {
                        filter: `points > ${user.points}`,
                        perPage: 1
                    });
                    overallRank = countData.totalItems + 1;
                } catch (e) {
                    overallRank = '?';
                }
            }

            let vObj = null;
            if (user.expand?.vehicle) {
                vObj = user.expand.vehicle;
            } else if (user.vehicle) {
                const vehicleIds = Array.isArray(user.vehicle) ? user.vehicle : [user.vehicle];
                const matched = STATE.vehicles.filter(v => vehicleIds.includes(v.id));
                vObj = Array.isArray(user.vehicle) ? matched : matched[0] || null;
            }

            return {
                ...user,
                overallRank: overallRank,
                levelObj: user.expand?.level || STATE.levels.find(l => l.id === user.level),
                vehicleObj: vObj
            };
        }));

        STATE.filteredUsers = rankedUsers;
        renderLeaderboard();
    } catch (error) {
        console.error("Filter query failed:", error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center py-8 text-rose-500">
                        Arama sırasında bir hata oluştu.
                    </td>
                </tr>
            `;
        }
    }
}

function renderVehicleStats() {
    const container = document.getElementById('vehicles-cards-container');
    container.innerHTML = '';

    if (!STATE.activeVehicles || STATE.activeVehicles.length === 0) {
        container.innerHTML = '<div class="podium-placeholder text-center w-full">Sürücüsü olan kayıtlı araç bulunamadı.</div>';
        return;
    }

    // Sort descending by ownerCount
    STATE.activeVehicles.sort((a, b) => b.ownerCount - a.ownerCount);

    const totalDrivers = STATE.activeVehicles.reduce((sum, v) => sum + v.ownerCount, 0);
    const themes = ['cyan', 'violet', 'amber', 'emerald', 'rose', 'blue'];

    STATE.activeVehicles.forEach((vehicle, index) => {
        const percentage = totalDrivers > 0 ? Math.round((vehicle.ownerCount / totalDrivers) * 100) : 0;
        const theme = themes[index % themes.length];

        const card = document.createElement('div');
        card.className = `vehicle-stat-card glass theme-${theme}`;
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="vehicle-card-accent-bar"></div>
            <div class="vehicle-card-header">
                <div class="vehicle-card-icon-wrapper">
                    <i data-lucide="car"></i>
                </div>
                <div class="vehicle-card-percentage-badge">%${percentage}</div>
            </div>
            <div class="vehicle-card-info">
                <h4 class="vehicle-card-brand">${vehicle.brand}</h4>
                <p class="vehicle-card-model">${vehicle.model}</p>
            </div>
            <div class="vehicle-card-progress-wrapper">
                <div class="vehicle-card-progress-track">
                    <div class="vehicle-card-progress-fill" style="width: ${percentage}%"></div>
                </div>
            </div>
            <div class="vehicle-card-footer">
                <span class="vehicle-card-count"><strong>${vehicle.ownerCount}</strong> Sürücü</span>
            </div>
        `;

        card.addEventListener('click', () => {
            switchToLeaderboardWithVehicleFilter(vehicle.id);
        });

        container.appendChild(card);
    });

    lucide.createIcons();
}

function switchToLeaderboardWithVehicleFilter(vehicleId) {
    // 1. Switch to leaderboard tab
    const leaderboardTab = document.getElementById('tab-leaderboard');
    if (leaderboardTab) {
        leaderboardTab.click();
    }

    // 2. Set filter dropdown value
    const vehicleSelect = document.getElementById('filter-vehicle');
    if (vehicleSelect) {
        vehicleSelect.value = vehicleId;
    }

    // 3. Trigger filters
    applyFilters();
}

// ==========================================================================
// CHART GENERATORS (CHART.JS)
// ==========================================================================

function renderCharts() {
    // Destroy existing charts to prevent hover bug redraws
    if (STATE.charts.activity) STATE.charts.activity.destroy();
    if (STATE.charts.vehicles) STATE.charts.vehicles.destroy();

    // Ensure canvas elements exist
    const canvasActivity = document.getElementById('chart-activity');
    const canvasVehicles = document.getElementById('chart-vehicles');

    if (!canvasActivity || !canvasVehicles) return;

    // ----------------------------------------------------
    // Chart 1: Activity Timeline (Line Chart)
    // ----------------------------------------------------
    const dailyCounts = {};

    // Initialize last 7 days with 0 counts to ensure they show up on the chart
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dailyCounts[dateStr] = 0;
    }

    // Count messages
    STATE.messages.forEach(msg => {
        if (msg.created) {
            // pocketbase date format is usually "YYYY-MM-DD HH:MM:SS.SSSZ" or ISO standard
            const datePart = msg.created.split(' ')[0] || new Date(msg.created).toISOString().split('T')[0];
            // Only add if it is in our key lists (we focus on dates with values or recent ones)
            if (dailyCounts[datePart] !== undefined) {
                dailyCounts[datePart]++;
            } else if (Object.keys(dailyCounts).length < 15) {
                // expand up to 14 days dynamic history
                dailyCounts[datePart] = 1;
            }
        }
    });

    // Sort dates
    const sortedDates = Object.keys(dailyCounts).sort();
    const dataPoints = sortedDates.map(date => dailyCounts[date]);

    // Format dates for display (e.g. "02 Haz")
    const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
    const labelsFormatted = sortedDates.map(dateStr => {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]} ${months[parseInt(parts[1]) - 1]}`;
        }
        return dateStr;
    });

    STATE.charts.activity = new Chart(canvasActivity, {
        type: 'line',
        data: {
            labels: labelsFormatted,
            datasets: [{
                label: 'Günlük Mesaj Sayısı',
                data: dataPoints,
                borderColor: '#0891b2',
                backgroundColor: 'rgba(8, 145, 178, 0.04)',
                borderWidth: 3,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#0e7490',
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.04)' },
                    ticks: { color: '#475569', font: { family: 'Plus Jakarta Sans', weight: '600' } }
                },
                y: {
                    grid: { color: 'rgba(0, 0, 0, 0.04)' },
                    ticks: { color: '#475569', stepSize: 10 }
                }
            }
        }
    });

    // ----------------------------------------------------
    // Chart 2: Vehicle Distribution (Doughnut Chart)
    // ----------------------------------------------------
    const vehicleLabels = [];
    const vehicleData = [];
    const vehicleColors = [
        '#0891b2', '#0ea5e9', '#2563eb', '#4f46e5', '#7c3aed',
        '#9333ea', '#c084fc', '#38bdf8', '#22d3ee', '#818cf8'
    ];

    if (STATE.activeVehicles && STATE.activeVehicles.length > 0) {
        const sorted = [...STATE.activeVehicles].sort((a, b) => b.ownerCount - a.ownerCount);
        sorted.forEach(v => {
            const name = `${v.brand} ${v.model}`;
            vehicleLabels.push(name);
            vehicleData.push(v.ownerCount);
        });
    }

    // Draw empty state indicator if no data
    if (vehicleData.length === 0) {
        vehicleLabels.push('Araç Verisi Yok');
        vehicleData.push(1);
        vehicleColors[0] = '#e2e8f0';
    }

    STATE.charts.vehicles = new Chart(canvasVehicles, {
        type: 'doughnut',
        data: {
            labels: vehicleLabels,
            datasets: [{
                data: vehicleData,
                backgroundColor: vehicleColors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#475569',
                        padding: 16,
                        font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' }
                    }
                },
                tooltip: {
                    backgroundColor: '#ffffff',
                    padding: 12,
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    titleColor: '#0f172a',
                    bodyColor: '#475569'
                }
            }
        }
    });
}

// ==========================================================================
// USER PROFILE DETAIL DRAWER MODAL
// ==========================================================================

async function showUserDetail(userId) {
    let user = STATE.users.find(u => u.id === userId) || STATE.filteredUsers.find(u => u.id === userId);

    // If user not in local cache, fetch from PocketBase
    if (!user) {
        try {
            const res = await fetchCollection('users', {
                filter: `id = '${userId}'`,
                expand: 'level,vehicle',
                perPage: 1
            });
            if (res.items && res.items.length > 0) {
                const fetched = res.items[0];
                let vObj = null;
                if (fetched.expand?.vehicle) {
                    vObj = fetched.expand.vehicle;
                } else if (fetched.vehicle) {
                    const vehicleIds = Array.isArray(fetched.vehicle) ? fetched.vehicle : [fetched.vehicle];
                    vObj = STATE.vehicles.filter(v => vehicleIds.includes(v.id));
                    if (!Array.isArray(fetched.vehicle)) vObj = vObj[0] || null;
                }
                user = {
                    ...fetched,
                    levelObj: fetched.expand?.level || STATE.levels.find(l => l.id === fetched.level),
                    vehicleObj: vObj
                };
            }
        } catch (e) {
            console.error('Failed to fetch user detail:', e);
        }
    }

    if (!user) return;

    const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Anonim';
    const initials = user.first_name ? user.first_name[0].toUpperCase() : 'U';

    // Set Details inside modal drawer
    const avatarContainer = document.getElementById('modal-user-avatar');
    if (user.avatar) {
        const avatarUrl = `${STATE.apiUrl}/api/files/users/${user.id}/${user.avatar}`;
        avatarContainer.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        avatarContainer.style.background = 'none';
        avatarContainer.style.padding = '0';
    } else {
        avatarContainer.textContent = initials;
        avatarContainer.style.background = '';
        avatarContainer.style.padding = '';
    }
    document.getElementById('modal-user-name').textContent = displayName;
    document.getElementById('modal-user-handle').textContent = user.username ? `@${user.username}` : 'Kullanıcı adı yok';

    // Set Telegram chat redirect URL / Copy Helper
    const tgBtn = document.getElementById('modal-btn-telegram');
    const noUsernameInfo = document.getElementById('modal-no-username-info');

    if (user.username) {
        tgBtn.href = `https://t.me/${user.username}`;
        tgBtn.style.display = 'flex';
        if (noUsernameInfo) noUsernameInfo.style.display = 'none';
    } else {
        tgBtn.style.display = 'none';
        if (noUsernameInfo) {
            noUsernameInfo.style.display = 'flex';

            // Bind click handler dynamically to ensure clean state
            const copyIdBtn = document.getElementById('btn-copy-tg-id');

            // Remove existing event listeners by replacing button with clone
            const newCopyIdBtn = copyIdBtn.cloneNode(true);
            copyIdBtn.parentNode.replaceChild(newCopyIdBtn, copyIdBtn);

            newCopyIdBtn.addEventListener('click', () => {
                const textToCopy = String(user.telegram_id);
                navigator.clipboard.writeText(textToCopy).then(() => {
                    const span = newCopyIdBtn.querySelector('span');
                    const originalText = span.textContent;
                    span.textContent = 'Kopyalandı!';
                    setTimeout(() => {
                        span.textContent = originalText;
                    }, 1500);
                });
            });
        }
    }

    const defaultLevel = [...STATE.levels].sort((a, b) => a.min_points - b.min_points)[0];
    const defaultBadge = defaultLevel?.badge || '🔋';
    const defaultName = defaultLevel?.name || 'Yeni Üye';

    const levelBadge = user.levelObj?.badge || defaultBadge;
    const levelName = user.levelObj?.name || defaultName;
    document.getElementById('modal-user-level').textContent = `${levelBadge} ${levelName}`;

    const vehiclesList = document.getElementById('modal-user-vehicles-list');
    vehiclesList.innerHTML = '';

    let hasVehicles = false;
    if (user.vehicleObj) {
        const vehicles = Array.isArray(user.vehicleObj) ? user.vehicleObj : [user.vehicleObj];
        if (vehicles.length > 0) {
            hasVehicles = true;
            vehicles.forEach(v => {
                const item = document.createElement('div');
                item.className = 'modal-vehicle-item';
                item.innerHTML = `
                    <i data-lucide="car" style="width: 16px; height: 16px;"></i>
                    <span>${v.brand} ${v.model}</span>
                `;
                vehiclesList.appendChild(item);
            });
        }
    }

    if (!hasVehicles) {
        vehiclesList.innerHTML = `
            <div style="font-size: 0.92rem; color: hsl(var(--text-muted)); font-weight: 500; font-style: italic; padding: 4px 0;">
                Kayıtlı araç bulunamadı.
            </div>
        `;
    }

    document.getElementById('modal-stat-points').textContent = user.points;
    document.getElementById('modal-stat-messages').textContent = user.message_count;
    document.getElementById('modal-stat-reactions').textContent = user.reaction_count;

    document.getElementById('modal-info-city').textContent = user.city || 'Belirtilmemiş';

    // Format First Seen date
    if (user.first_seen) {
        const d = new Date(user.first_seen);
        const opt = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        document.getElementById('modal-info-first-seen').textContent = d.toLocaleDateString('tr-TR', opt);
    } else {
        document.getElementById('modal-info-first-seen').textContent = '-';
    }

    // Trigger opening animation
    const modal = document.getElementById('user-detail-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // prevent bg scroll
    lucide.createIcons();
}

function closeModal() {
    const modal = document.getElementById('user-detail-modal');
    modal.classList.remove('active');
    document.body.style.overflow = ''; // restore scroll
}

function renderCityStats() {
    const container = document.getElementById('city-distribution-list');
    if (!container) return;
    container.innerHTML = '';

    const cityCounts = STATE.cityCounts || {};
    const registeredUsersCount = STATE.totalWithCity || 0;

    // Sort cities by user count descending
    const sortedCities = Object.keys(cityCounts)
        .map(city => ({ name: city, count: cityCounts[city] }))
        .sort((a, b) => b.count - a.count);

    if (sortedCities.length === 0) {
        container.innerHTML = `
            <div style="font-size: 0.95rem; color: hsl(var(--text-muted)); font-weight: 500; text-align: center; padding: 32px 0;">
                Şehir bilgisi paylaşan üye bulunmuyor.
            </div>
        `;
        return;
    }

    // Take top 5 cities
    const topCities = sortedCities.slice(0, 5);

    topCities.forEach(city => {
        const percentage = Math.round((city.count / registeredUsersCount) * 100);

        const row = document.createElement('div');
        row.className = 'city-stat-row';
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.gap = '6px';

        row.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 0.92rem; font-weight: 700; color: hsl(var(--text-primary));">
                <span>${city.name}</span>
                <span>%${percentage} <span style="font-weight: 500; color: hsl(var(--text-muted));">(${city.count} Üye)</span></span>
            </div>
            <div style="width: 100%; height: 8px; background: rgba(8, 145, 178, 0.05); border-radius: 99px; overflow: hidden; border: 1px solid rgba(8, 145, 178, 0.08);">
                <div style="width: ${percentage}%; height: 100%; background: var(--primary-grad); border-radius: 99px; transition: var(--transition-smooth);"></div>
            </div>
        `;
        container.appendChild(row);
    });
}

function initMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    if (mobileMenuBtn && sidebar && sidebarOverlay) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.add('active');
            sidebarOverlay.classList.add('active');
        });
    }

    function closeMobileMenu() {
        if (sidebar && sidebarOverlay) {
            sidebar.classList.remove('active');
            sidebarOverlay.classList.remove('active');
        }
    }

    if (sidebarCloseBtn) {
        sidebarCloseBtn.addEventListener('click', closeMobileMenu);
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeMobileMenu);
    }

    // Close menu when a menu item is clicked on mobile
    const menuItems = document.querySelectorAll('.sidebar-menu .menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', closeMobileMenu);
    });
}
