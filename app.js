// TuneX Music Player - Web Logic Core (Premium Full-Stack)
const SEARCH_CACHE = new Map();

let currentPlayer = null;
let currentTrack = null;
let nextQueue = [];
let recentHistory = [];
const navHistory = ['home'];
let isGoingBack = false;
const LocalDB = {
    get: (key) => JSON.parse(localStorage.getItem(`tunex_${key}`) || (key === 'playlists' ? '{}' : '[]')),
    save: (key, data) => localStorage.setItem(`tunex_${key}`, JSON.stringify(data)),
    
    addToHistory: (track) => {
        let history = LocalDB.get('history');
        history = history.filter(t => t.id !== track.id);
        history.unshift(track);
        LocalDB.save('history', history.slice(0, 50));
    },
    
    getPlaylists: () => LocalDB.get('playlists'),
    createPlaylist: (name) => {
        let p = LocalDB.get('playlists');
        if (!p[name]) { p[name] = []; LocalDB.save('playlists', p); return true; }
        return false;
    },
    addToPlaylist: (name, track) => {
        let p = LocalDB.get('playlists');
        if (p[name] && !p[name].find(t => t.id === track.id)) {
            p[name].push(track); LocalDB.save('playlists', p); return true;
        }
        return false;
    }
};

const player = {
    next: () => {
        if (nextQueue.length > 0) {
            playTrack(nextQueue.shift());
        } else {
            setNativeBackgroundAudio(false); 
        }
    },
    prev: () => {
        if (recentHistory.length > 1) {
            recentHistory.pop(); 
            const prev = recentHistory.pop();
            if (prev) playTrack(prev);
        }
    }
};

// Global aliases for MediaSession and Handlers
function playNext() { player.next(); }
function playPrev() { player.prev(); }

// API Configuration: Point to Production Vercel if running in Native App
const IS_CAPACITOR = window.Capacitor !== undefined;
const BASE_URL = IS_CAPACITOR ? "https://tunex-app.vercel.app" : "";

// Help Median.co (GoNative) or Capacitor handle background audio
function setNativeBackgroundAudio(active) {
    if (IS_CAPACITOR) {
        // Capacitor handled via MediaSession plugin
        return;
    }
    const bridge = window.median || window.gonative;
    if (bridge && bridge.backgroundAudio) {
        if (active) bridge.backgroundAudio.start();
        else bridge.backgroundAudio.stop();
    }
}

// Global Audio/Video Players
let nativeAudioEngine = null;
let ytPlayer = null;
let isPlayerReady = false;
let pendingTrack = null;

// The YouTube API calls this function once it's fully loaded
window.onYouTubeIframeAPIReady = function() {
    ytPlayer = new YT.Player('yt-player-target', {
        height: '10',
        width: '10',
        playerVars: {
            'playsinline': 1,
            'controls': 0,
            'disablekb': 1,
            'modestbranding': 1,
            'rel': 0,
            'autoplay': 1,
            'enablejsapi': 1
        },
        events: {
            'onReady': (e) => {
                console.log("TuneX Engine Ready 🚀");
                isPlayerReady = true;
                e.target.unMute();
                e.target.setVolume(100);
                
                // Play queued track if any
                if (pendingTrack) {
                    playTrack(pendingTrack);
                    pendingTrack = null;
                }
            },
            'onError': (e) => {
                console.warn("TuneX Stream Error:", e.data);
                setPlaybackStatus("Retrying next track...");
                playNext(); // Auto-skip restricted/broken songs
            },
            'onStateChange': (e) => {
                if (e.data === YT.PlayerState.PLAYING) {
                    setPlaybackStatus("");
                    updatePlayPauseIcons(true); // Sync Icons
                    
                    // RECURSIVE SOUND HANDSHAKE (Safe & Optimized)
                    if (window.hHandshake) clearInterval(window.hHandshake);
                    
                    let handshakeCount = 0;
                    window.hHandshake = setInterval(() => {
                        if (ytPlayer && ytPlayer.unMute) {
                            ytPlayer.unMute();
                            ytPlayer.setVolume(100);
                        }
                        handshakeCount++;
                        if (handshakeCount > 6) clearInterval(window.hHandshake);
                    }, 800);

                    if (nativeAudioEngine) nativeAudioEngine.pause(); 
                }
                if (e.data === YT.PlayerState.PAUSED) {
                    updatePlayPauseIcons(false);
                }
                if (e.data === YT.PlayerState.BUFFERING) setPlaybackStatus("Buffering Stream...");
                if (e.data === YT.PlayerState.ENDED) {
                    if (nativeAudioEngine) nativeAudioEngine.play().catch(() => {}); // Re-claim focus
                    playNext();
                }
            }
        }
    });
};

function initYouTubeAPI() {
    if (typeof YT === 'undefined') {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
}

// --- 1. Initialization ---
window.onload = () => {
    nativeAudioEngine = document.getElementById('main-audio-engine');
    
    // Support Background Modes
    if (nativeAudioEngine) {
        nativeAudioEngine.volume = 0; // Prevent Audio Ducking
        nativeAudioEngine.onended = () => nativeAudioEngine.play(); // Infinite silent loop
    }

    initYouTubeAPI();
    loadDashboard();
    setupEventListeners();
    updateGreeting();

    // Unlock Audio Context on first click (Vital for Mobile Apps/WebViews)
    document.addEventListener('click', () => {
        if (nativeAudioEngine && nativeAudioEngine.paused) {
            nativeAudioEngine.play().catch(() => {});
            console.log("Audio Context Unlocked 🔓");
        }
    }, { once: true });
};

function setPlaybackStatus(status) {
    const el = document.getElementById('full-artist'); // We can reuse artist field for status
    if (el && currentTrack) {
        el.textContent = status || currentTrack.uploader;
    }
}

function switchPage(pageId) {
    document.querySelectorAll('.nav-item, .bn-item').forEach(item => {
        item.classList.remove('active');
    });
    // Manual active class handling for nav items
    const navItems = document.querySelectorAll('.nav-item, .bn-item');
    navItems.forEach(item => {
        if (item.getAttribute('onclick') && item.getAttribute('onclick').includes(pageId)) {
            item.classList.add('active');
        }
    });

    document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
    const targetPage = document.getElementById(`${pageId}-page`);
    if (targetPage) targetPage.classList.add('active');

    // TRACK HISTORY
    if (!isGoingBack) {
        if (navHistory[navHistory.length - 1] !== pageId) {
            navHistory.push(pageId);
        }
    }
    isGoingBack = false;

    if (pageId === 'home') loadDashboard();
    if (pageId === 'search') loadSearch();
    if (pageId === 'trending') loadTrending();
    if (pageId === 'library') loadLibrary();

    // Trigger Entrance Animation after a tiny delay for DOM painting
    setTimeout(() => {
        if (targetPage) targetPage.classList.add('active');
    }, 10);

    // Critical Performance: Clear background handshakes on every page switch
    if (window.hHandshake) clearInterval(window.hHandshake);
}

function goBack() {
    if (navHistory.length > 1) {
        navHistory.pop(); // Remove current
        const prev = navHistory[navHistory.length - 1];
        isGoingBack = true;
        switchPage(prev);
    } else {
        switchPage('home');
    }
}

function updateGreeting() {
    const hour = new Date().getHours();
    const g = document.getElementById('greeting');
    if (!g) return;
    
    let text = "";
    if (hour < 5) text = "Late Night Vibe 🌌";
    else if (hour < 12) text = "Good Morning ☀️";
    else if (hour < 17) text = "Good Afternoon 🌤️";
    else if (hour < 21) text = "Good Evening 🌙";
    else text = "Late Night Vibe 🌌";
    
    g.innerHTML = `<span style="opacity: 0.5; font-size: 0.6em; display: block; letter-spacing: 2px; font-weight: 700; margin-bottom: 5px;">WELCOME TO TUNEX</span>${text}`;
}

// --- 2. Backend Bridge ---
async function youtubeSearch(query, isTrending = false, isHome = false) {
    const cacheKey = `${query}_${isTrending}_${isHome}`;
    if (SEARCH_CACHE.has(cacheKey)) return SEARCH_CACHE.get(cacheKey);

    try {
        const url = isTrending
            ? `${BASE_URL}/api/search?trending=true&home=${isHome}`
            : `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&home=${isHome}`;

        const response = await fetch(url);
        const results = await response.json();

        if (results && results.length > 0) {
            SEARCH_CACHE.set(cacheKey, results);
            return results;
        }
        return [];
    } catch (e) {
        console.error("Backend Error", e);
        return [];
    }
}



const GENRES = [
    "Trending", "Hindi", "Punjabi", "Haryanvi", "Gujarati",
    "Marathi", "Reels Special", "Lofi Chill", "Devotional", "90s Hits"
];

let activeGenre = null;

// CURATED HIGH-RES ARTIST PORTRAITS (STABLE LINKS)
const CURATED_ARTISTS = {
    "Arijit Singh": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRETraqkav99oDFbUFGsbCDZl0Mteg_X51A8QGEdAE7vwEtf5WxDLa__Nl6HP71zQTFI7scIFhdXe-HvmMlZTX9grvaQBvTHDmR8-dRxiCzGQ&s=10",
    "Neha Kakkar": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRTFj-9ITEzixLHcyoE3KWr4ouUAPBhR29E8tORO8RupkbAst-eackdOLk-6sZDIbjBJx1ICw1ERrMoSzWGhKB0Mj_Jl9vUQ2-O4SqQCUEy&s=10",
    "Pritam": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQHc4qT1i8BFM3WXNnx6VjhdTOVHz5rD4cU2CgWem15V2VNxW5Mt5n4Fw1biDuRJzBbXs_qQCPmupIyXfxHG3D_gcXl5CS-XmdRCnaH6lyM&s=10",
    "A.R. Rahman": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRKZz4zGJvU4koWD3DS3q_3ovrwt6TgNuMp8V1vcA-WyKJJPGCKPTkwWIrNE4KSdOsT9Ggis_aME7OPHk1N43MblXc16Wvtxi7AQjSzQHmfbA&s=10",
    "Shreya Ghoshal": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRUKz1vEV6Aj3gzB4BEviCF5fwEaKpr05R8yl_U9-BoxrAqI6BnqGHMIc1a_tQ2Yw2BXQdOLgMqNd1CQqMk0xgzn_RRVgp762KjmKEw9p6-&s=10",
    "Atif Aslam": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS1tCa-9TZ6ZKFh5oAYKGksB7yXuh3HxVBKDnDIc9-fG6ZaE3CjST52Fr5lTuxURNGSsgNRZ2V096lyfIRUIdIytXbTRRREEk9FghB_tDH4PQ&s=10",
    "Diljit Dosanjh": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRXfY1DhaCBMBuzZvxk-gDFNsU6ECeU25uZSIdJgXPCQ6VIp5ipoLztB6Nf4XlSMSd9lkwTMa4QCx94xuXpDwV7zbgkSAIEojiM_ByHv5a6&s=10",
    "Badshah": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_M1hCCnHLb45Z9h3jrgcXJR0p84_hjZcM176pkqhyjPCF29ew--0-pXKd1cfMm-qALZ2odmjz2hvgSHqhRgmkNnzRhFiIJcRXyAtLSaRzxQ&s=10",
    "Jubin Nautiyal": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSuPRfMvsQTwm6V9AyfdOLI-s0opkSaxsVGRPpfmRVEi4MxJ5-RW4qnKJQUleTS22Tpbe3qgILbSbsJo5zX78BFpVjYJyihJ-mUwbCXUgaO&s=10"
};
const TOP_SINGERS = Object.keys(CURATED_ARTISTS);

async function loadDashboard() {
    if (activeGenre) {
        renderGenreDiscovery(activeGenre);
        return;
    }

    const categories = [
        { title: "Romantic Hits 💖", query: "latest bollywood love songs 2026" },
        { title: "Party Anthems 🕺", query: "bollywood dance party hits 2026" },
        { title: "Lofi Vibes ☁️", query: "hindi lofi chill mix 2026" },
        { title: "Viral Reels 🤳", query: "trending instagram reels songs" },
        { title: "90s Golden Era 📻", query: "best 90s bollywood songs" },
        { title: "Punjabi Fresh 🚩", query: "new punjabi songs 2026 latest" },
        { title: "Workout Energy ⚡", query: "gym workout motivation songs hindi" },
        { title: "Sad Melodies 🌧️", query: "bollywood heart touching sad songs 2026" }
    ];

    const rowsContainer = document.getElementById('home-rows');
    rowsContainer.innerHTML = '';

    const rowMappings = categories.map((cat, index) => {
        const row = document.createElement('div');
        const rowId = `row-${cat.title.replace(/[^\w]/g, '')}`;
        row.innerHTML = `<h2 class="section-header">${cat.title}</h2><div class="card-grid" id="${rowId}"><div class="loading">Connecting...</div></div>`;
        rowsContainer.appendChild(row);

        if (index === 2) {
            const singerRow = document.createElement('div');
            singerRow.innerHTML = `<h2 class="section-header">Top Singers India 🌟</h2><div class="artist-grid" id="top-singers-row"></div>`;
            rowsContainer.appendChild(singerRow);
        }

        return { ...cat, rowId };
    });

    // 2. TURBO PARALLEL FETCHING (Increasing from 3 to 6 at once)
    const seed = Math.floor(Math.random() * 999999);
    const priorities = rowMappings.slice(0, 6);
    const defaults = rowMappings.slice(6);

    // Speed up top rows first
    await Promise.all(priorities.map(async (cat) => {
        let r;
        if (cat.isRecommendation) {
            const res = await fetch(`${BASE_URL}/api/recommendations?home=true&v=${seed}`);
            r = await res.json();
        } else {
            // Passing seed to ensure un-cached backend sampling
            const url = cat.isTrending ? 
                `${BASE_URL}/api/search?trending=true&home=true&seed=${seed}` : 
                `${BASE_URL}/api/search?q=${encodeURIComponent(cat.query)}&home=true&seed=${seed}`;
            const res = await fetch(url);
            r = await res.json();
        }

        const grid = document.getElementById(cat.rowId);
        if (grid) {
            grid.innerHTML = '';
            if (r && r.length > 0) renderCards(r, cat.rowId);
            else grid.innerHTML = '<div class="empty-state">No hits found. Try refreshing!</div>';
        }
    }));

    // Lazy load the rest in the background
    setTimeout(() => {
        defaults.forEach(async (cat) => {
            let r;
            if (cat.isRecommendation) {
                const res = await fetch(`/api/recommendations?home=true&v=${seed}`);
                r = await res.json();
            } else {
                const url = cat.isTrending ? 
                    `/api/search?trending=true&home=true&seed=${seed}` : 
                    `/api/search?q=${encodeURIComponent(cat.query)}&home=true&seed=${seed}`;
                const res = await fetch(url);
                r = await res.json();
            }
            const grid = document.getElementById(cat.rowId);
            if (grid) grid.innerHTML = '';
            renderCards(r, cat.rowId);
        });
    }, 1500);

    renderArtists();
    renderFilterBar();
}

function renderFilterBar() {
    const container = document.getElementById('home-filter-chips');
    if (!container) return;
    container.innerHTML = '';
    GENRES.forEach(genre => {
        const chip = document.createElement('div');
        chip.className = `filter-chip ${activeGenre === genre ? 'active' : ''}`;
        chip.innerText = genre;
        chip.onclick = () => {
            activeGenre = (activeGenre === genre) ? null : genre;
            loadDashboard();
        };
        container.appendChild(chip);
    });
}

async function renderGenreDiscovery(genre) {
    const rowsContainer = document.getElementById('home-rows');
    rowsContainer.innerHTML = `<h2 class="section-header">${genre} Viral Hits 🚀</h2><div class="card-grid" id="genre-grid"><div class="loading">Fetching ${genre} Pulse...</div></div>`;

    // Specifically search for Latest/Viral content for this genre
    const query = genre === "Trending" ? "" : `${genre} viral songs latest 2026`;
    const isTrending = genre === "Trending";

    const url = isTrending ? `${BASE_URL}/api/search?trending=true&v=${Date.now()}` : `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&v=${Date.now()}`;
    const res = await fetch(url);
    const results = await res.json();
    
    const grid = document.getElementById('genre-grid');
    if (grid) {
        grid.innerHTML = '';
        renderCards(results, 'genre-grid');
    }
    renderFilterBar();
}

async function loadTrending() {
    const grid = document.getElementById('trending-grid');
    if (!grid) return;

    grid.innerHTML = '<div class="loading">Fetching India\'s Hot Hits...</div>';

    // Fetch a mix of India's most viral, most viewed and most trending (Strictly Latest)
    try {
        const res = await fetch(`${BASE_URL}/api/search?trending=true&home=true&v=${Date.now()}`);
        const results = await res.json();
        grid.innerHTML = '';
        renderCards(results, 'trending-grid');
    } catch (e) {
        grid.innerHTML = '<div class="error">Failed to load trends. Try again!</div>';
    }
}

async function renderArtists() {
    const container = document.getElementById('top-singers-row');
    if (!container) return;
    container.innerHTML = '';

    TOP_SINGERS.forEach(name => {
        const artist = document.createElement('div');
        artist.className = 'artist-card';
        const safeName = name.replace(/\s+/g, '');

        // Use Curated HD image if available, else placeholder
        const defaultAvatar = `https://cdn-icons-png.flaticon.com/512/3135/3135715.png`; // Premium user icon
        const imgUrl = CURATED_ARTISTS[name] || defaultAvatar;

        artist.innerHTML = `
            <div class="artist-img-wrapper">
                <img src="${imgUrl}" id="artist-img-${safeName}" 
                     onerror="this.src='${defaultAvatar}'; this.style.opacity='0.5';">
            </div>
            <div class="name">${name}</div>
            <div class="type">Artist</div>
        `;

        artist.onclick = () => {
            switchPage('search');
            document.getElementById('search-bar').value = name;
            document.getElementById('search-bar').dispatchEvent(new Event('input'));
        };
        container.appendChild(artist);

        // If not in curated list, try fetching dynamic avatar as fallback
        if (!CURATED_ARTISTS[name]) {
            fetch(`${BASE_URL}/api/artist_avatar?q=${encodeURIComponent(name)}`).then(res => res.json()).then(data => {
                if (data.url) document.getElementById(`artist-img-${safeName}`).src = data.url;
            });
        }
    });
}

// --- 6. UTILITY: Median.co Background Bridge ---
function setMedianBackgroundAudio(isPlaying) {
    if (typeof median !== 'undefined' && median.backgroundAudio) {
        if (isPlaying) {
            median.backgroundAudio.start();
            console.log("Median Bridge: Background Audio ON");
        } else {
            median.backgroundAudio.stop();
            console.log("Median Bridge: Background Audio OFF");
        }
    } else {
        // Fallback for browser (No median object)
        console.log("Median Bridge: Not detected (Running in browser)");
    }
}

async function loadSearch() {
    const sb = document.getElementById('search-bar');
    const recSection = document.getElementById('search-recommendations');
    const resultsGrid = document.getElementById('search-results');

    if (!sb.value || sb.value.length === 0) {
        recSection.style.display = 'block';
        resultsGrid.innerHTML = '';

        // Populate "Discover New Vibes" with some high-quality suggestions
        const recGrid = document.getElementById('search-rec-grid');
        if (recGrid && recGrid.innerHTML === '') {
            recGrid.innerHTML = '<div class="loading">Finding vibes...</div>';
            const res = await fetch(`${BASE_URL}/api/search?q=latest%20bollywood%20songs%202026&v=${Date.now()}`);
            const suggestions = await res.json();
            recGrid.innerHTML = '';
            renderCards(suggestions, 'search-rec-grid');
        }
    } else {
        recSection.style.display = 'none';
    }
}

function renderCards(results, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !results) return;
    
    // 1. CLEAR AND SHOW SKELETONS (The Premium Feel)
    // We only show skeletons if the grid was empty or it's a new batch
    if (container.innerHTML === "" || container.classList.contains('card-grid')) {
       // Skeleton placeholder loop (3 items for mini-rows, 6 for grids)
       let skeletonHTML = "";
       for(let i=0; i<6; i++) {
           skeletonHTML += `<div class="card skeleton" style="height: 240px; margin-bottom: 24px; pointer-events:none; border:none;"></div>`;
       }
       container.innerHTML = skeletonHTML;
    }

    // 2. Performance Optimization: Delay the actual render slightly for visual silkiness
    setTimeout(() => {
        container.innerHTML = "";
        const fragment = document.createDocumentFragment();
        
        // SVG Templates for instant rendering (Zero Lag)
        const playSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M5 3l14 9-14 9V3z"/></svg>`;
        const plusSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

        results.slice(0, 30).forEach(track => {
            const card = document.createElement('div');
            card.className = 'card track-card';
            card.innerHTML = `
                <div class="card-img-container">
                    <img src="${track.thumbnail}" loading="lazy" onerror="this.src='/logo.png'">
                    <div class="card-play-overlay">
                        ${playSvg}
                    </div>
                    <button class="card-plus-btn" onclick="openPlaylistModal(event, ${JSON.stringify(track).replace(/"/g, '&quot;')})">
                        ${plusSvg}
                    </button>
                </div>
                <div class="card-title">${track.title}</div>
                <div class="subtitle">${track.uploader}</div>
            `;
            card.onclick = (e) => {
                if (!e.target.closest('.card-plus-btn')) playTrack(track);
            };
            fragment.appendChild(card);
        });
        
        container.appendChild(fragment);
    }, 400); // 400ms shimmer duration for that spotify look
}

// YouTube Engine logic moved to top for reliability

async function playTrack(track) {
    if (!track || !track.id) return;
    currentTrack = track;

    // 1. UI Status
    updateUI(track);
    setPlaybackStatus("Loading Stream..."); 
    updateAmbientGlow(track.thumbnail);

    // 2. The "Final Boss" Playback Logic (Official API Fix)
    if (ytPlayer && isPlayerReady) {
        // SYNCHRONOUS HANDSHAKE: Must happen inside the click event to unlock audio
        try {
            if (nativeAudioEngine) nativeAudioEngine.pause(); // Release Focus
            ytPlayer.unMute();
            ytPlayer.setVolume(100);
            ytPlayer.loadVideoById(track.id);
            ytPlayer.playVideo();
        } catch (e) {
            console.log("Handshake Fallback");
            ytPlayer.unMute();
            ytPlayer.setVolume(100);
            ytPlayer.loadVideoById(track.id);
            ytPlayer.playVideo();
        }
    } else {
        console.log("Engine not ready. Queuing track...");
        pendingTrack = track;
        initYouTubeAPI(); // Ensure it starts loading
    }

    // 3. Manual Progress Timer (Since we skip the complex API)
    startProgressTimer(track.duration || 180); // Fallback to 3m

    LocalDB.addToHistory(track);
    recentHistory.push(track);
    fetchUpNext(track);
}

let songTimer = null;
let currentSeconds = 0;

function startProgressTimer(duration) {
    if (songTimer) clearInterval(songTimer);
    currentSeconds = 0;
    
    songTimer = setInterval(() => {
        currentSeconds++;
        const pct = (currentSeconds / duration) * 100;
        
        const sliders = ['mini-progress', 'full-progress'];
        sliders.forEach(id => {
            const s = document.getElementById(id);
            if (s) s.value = pct || 0;
        });

        const ct = document.getElementById('current-time');
        const tt = document.getElementById('total-time');
        if (ct) ct.textContent = formatTime(currentSeconds);
        if (tt) tt.textContent = formatTime(duration);

        if (currentSeconds >= duration) {
            clearInterval(songTimer);
            playNext();
        }
    }, 1000);
}

async function fetchUpNext(track) {
    const grid = document.getElementById('full-up-next-grid');
    if (grid) grid.innerHTML = '<div class="loading">Finding next vibes...</div>';

    // BETTER LOGIC: Search for artist's other hits instead of just "similar"
    // Also use negative filters to avoid remixes/reactions
    const seed = `best songs by ${track.uploader} -remix -reaction -cover`;
    const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(seed)}&limit=20`);
    let results = await res.json();

    if (results && results.length > 0) {
        // FILTER: Remove the current song from the recommendations
        results = results.filter(item => item.id !== track.id);

        nextQueue = results;
        renderUpNext(results);
    }
}

function renderUpNext(results) {
    const grid = document.getElementById('full-up-next-grid');
    if (!grid) return;
    grid.innerHTML = '';

    results.forEach(track => {
        const item = document.createElement('div');
        item.className = 'up-next-card';
        item.innerHTML = `
            <img src="${track.thumbnail}">
            <div class="info">
                <div class="title">${track.title}</div>
                <div class="artist">${track.uploader}</div>
            </div>
            <i data-lucide="play-circle" style="opacity: 0.5;"></i>
        `;
        item.onclick = (e) => {
            e.stopPropagation();
            playTrack(track);
        };
        grid.appendChild(item);
    });
    lucide.createIcons();
}

function updateUI(track) {
    // Show Players
    const miniPlayer = document.getElementById('mini-player');
    miniPlayer.classList.add('visible');

    // Update Mini Player
    document.getElementById('mini-thumb').src = track.thumbnail;
    document.getElementById('mini-title').textContent = track.title;
    document.getElementById('mini-artist').textContent = track.uploader;

    // Update Full Player
    document.getElementById('full-art').src = track.thumbnail;
    document.getElementById('full-title').textContent = track.title;
    document.getElementById('full-artist').textContent = track.uploader;

    // MEDIA SESSION (LOCK SCREEN CONTROLS)
    updateMediaSession(track);

    lucide.createIcons();
}

async function updateMediaSession(track) {
    if (IS_CAPACITOR) {
        try {
            const { CapacitorMediaSession } = Capacitor.Plugins;
            await CapacitorMediaSession.setMetadata({
                title: track.title,
                artist: track.uploader,
                album: 'TuneX Discovery',
                artwork: track.thumbnail
            });
            CapacitorMediaSession.addListener('play', () => togglePlay());
            CapacitorMediaSession.addListener('pause', () => togglePlay());
            CapacitorMediaSession.addListener('next', () => playNext());
            CapacitorMediaSession.addListener('previoustrack', () => playPrev());
        } catch (e) { console.error("Capacitor Media Session error:", e); }
    } else if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.uploader,
            album: 'TuneX Premium',
            artwork: [
                { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' },
                { src: track.thumbnail, sizes: '192x192', type: 'image/jpeg' },
            ]
        });

        // ACTION HANDLERS (One-time registration)
        if (!window.mediaHandlersSet) {
            navigator.mediaSession.setActionHandler('play', () => togglePlay());
            navigator.mediaSession.setActionHandler('pause', () => togglePlay());
            navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
            navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(details.seekTime);
            });
            window.mediaHandlersSet = true;
        }
    }
}

function togglePlay() {
    if (!ytPlayer || !ytPlayer.getPlayerState) return;
    const state = ytPlayer.getPlayerState();
    
    if (state === YT.PlayerState.PLAYING) {
        ytPlayer.pauseVideo();
        if (nativeAudioEngine) nativeAudioEngine.pause();
        updatePlayPauseIcons(false);
    } else {
        if (ytPlayer.unMute) {
            ytPlayer.unMute();
            ytPlayer.setVolume(100);
        }
        ytPlayer.playVideo();
        // Removed nativeAudioEngine.play() here to prevent focus theft
        updatePlayPauseIcons(true);
    }
}

// Global Sync for the Silent Engine (Keeps app alive - NO UI IMPACT)
if (nativeAudioEngine) {
    nativeAudioEngine.onended = () => playNext();
    nativeAudioEngine.onwaiting = () => setPlaybackStatus("Buffering Stream...");
    nativeAudioEngine.onplaying = () => setPlaybackStatus("");
}

function updatePlayPauseIcons(isPlaying) {
    const iconName = isPlaying ? 'pause' : 'play';
    const btns = ['play-pause-btn', 'full-play-pause'];
    btns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        }
    });

    // Synchronize System Notification State (PRO feature for Mobile Apps)
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }

    lucide.createIcons();
}

function seekTrack(value) {
    if (!ytPlayer || !ytPlayer.getDuration) return;
    const duration = ytPlayer.getDuration();
    if (!duration) return;
    const seekTo = (value / 100) * duration;
    
    ytPlayer.seekTo(seekTo, true);
    currentSeconds = Math.floor(seekTo); // Sync manual timer
}

// Old Progress Tracker Removed (Now using startProgressTimer for 100% Sync)

function formatTime(s) {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sc = Math.floor(s % 60);
    return `${m}:${sc < 10 ? '0' : ''}${sc}`;
}

function openFullPlayer() {
    const fp = document.getElementById('full-player');
    fp.style.display = 'flex';
    setTimeout(() => fp.classList.add('visible'), 10);
}
function closeFullPlayer() {
    const fp = document.getElementById('full-player');
    fp.classList.remove('visible');
    setTimeout(() => fp.style.display = 'none', 600);
}



// initYouTubeAPI moved to top

// --- 6. Playlist Discovery & Management ---
let trackToSave = null;

function openPlaylistModal(e, track = null) {
    if (e) e.stopPropagation();
    trackToSave = track || currentTrack;
    if (!trackToSave) return;

    const modal = document.getElementById('playlist-modal');
    modal.classList.add('active');
    refreshModalPlaylists();
}

function closePlaylistModal(e) {
    document.getElementById('playlist-modal').classList.remove('active');
}

async function refreshModalPlaylists() {
    const list = document.getElementById('modal-playlist-list');
    list.innerHTML = '';
    const playlists = LocalDB.getPlaylists();

    Object.keys(playlists).forEach(name => {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        item.innerHTML = `<i data-lucide="list-music"></i><span>${name}</span>`;
        item.onclick = () => addToPlaylist(name);
        list.appendChild(item);
    });
    lucide.createIcons();
}

async function createNewPlaylist() {
    const name = document.getElementById('new-playlist-name').value;
    if (!name) return;
    LocalDB.createPlaylist(name);
    document.getElementById('new-playlist-name').value = '';
    addToPlaylist(name);
}

async function addToPlaylist(playlistName) {
    if (!trackToSave) return;
    const success = LocalDB.addToPlaylist(playlistName, trackToSave);

    if (success) {
        const btns = document.querySelectorAll('.plus-btn');
        btns.forEach(b => {
            b.classList.add('btn-add-success');
            const icon = b.querySelector('i');
            if (icon) icon.setAttribute('data-lucide', 'check');
        });
        lucide.createIcons();

        setTimeout(() => {
            const modal = document.getElementById('playlist-modal');
            modal.classList.remove('active');
            btns.forEach(b => {
                b.classList.remove('btn-add-success');
                const icon = b.querySelector('i');
                if (icon) icon.setAttribute('data-lucide', 'plus');
            });
            lucide.createIcons();
        }, 1500);
    }
}

// Update loadLibrary to show playlists too
async function loadLibrary() {
    const historyData = LocalDB.get('history');
    const libGrid = document.getElementById('library-grid');
    libGrid.innerHTML = '';

    // 1. Show Playlists FIRST
    const playlists = LocalDB.getPlaylists();

    Object.keys(playlists).forEach(name => {
        const card = document.createElement('div');
        card.className = 'card playlist-folder';
        card.innerHTML = `
            <div class="folder-icon"><i data-lucide="folder-heart"></i></div>
            <div class="title">${name}</div>
            <div class="subtitle">${playlists[name].length} songs</div>
        `;
        card.onclick = () => showPlaylistTracks(name, playlists[name]);
        libGrid.appendChild(card);
    });

    // 2. Show History
    const historyHeader = document.createElement('h2');
    historyHeader.className = 'section-header';
    historyHeader.style.gridColumn = '1 / -1';
    historyHeader.style.marginTop = '40px';
    historyHeader.textContent = "Recently Played";
    libGrid.appendChild(historyHeader);

    historyData.forEach(track => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<img src="${track.thumbnail}"><div class="title">${track.title}</div><div class="subtitle">Played on TuneX</div>`;
        card.onclick = () => playTrack(track);
        libGrid.appendChild(card);
    });
    lucide.createIcons();
}

function showPlaylistTracks(name, tracks) {
    const libGrid = document.getElementById('library-grid');
    libGrid.innerHTML = `<h2 class="section-header" style="grid-column: 1 / -1;"><span onclick="loadLibrary()" style="cursor:pointer; opacity:0.6;">Library</span> / ${name}</h2>`;

    if (tracks.length === 0) {
        libGrid.innerHTML += '<div class="empty-state">No songs in this playlist yet. Add some!</div>';
    } else {
        tracks.forEach(track => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `<img src="${track.thumbnail}"><div class="title">${track.title}</div><div class="subtitle">In ${name}</div>`;
            card.onclick = () => playTrack(track);
            libGrid.appendChild(card);
        });
    }
}



function updateAmbientGlow(url) {
    const layer = document.querySelector('.ambient-glow-layer');
    if (!layer) return;

    const img = new Image();
    img.crossOrigin = "Anonymous";
    // Use the proxy to avoid CORS issues for color extraction
    img.src = `/api/proxy_image?url=${encodeURIComponent(url)}`;
    
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 1; canvas.height = 1;
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        
        // Premium Glow: Slightly more saturated and darker for premium look
        // We use a stronger opacity (0.6) and a larger spread for the master overhaul
        layer.style.background = `radial-gradient(circle at 50% 50%, rgba(${r},${g},${b},0.6) 0%, transparent 85%)`;
    };
}

function setupEventListeners() {
    const sb = document.getElementById('search-bar');
    const recSection = document.getElementById('search-recommendations');
    const resultsGrid = document.getElementById('search-results');

    let timer;
    sb.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        clearTimeout(timer);

        if (val.length === 0) {
            recSection.style.display = 'block';
            resultsGrid.innerHTML = '';
            return;
        }

        recSection.style.display = 'none';

        timer = setTimeout(async () => {
            if (val.length < 2) return;
            resultsGrid.innerHTML = '<div class="loading">Searching TuneX...</div>';
            
            // Performance Boost: Stop background handshakes to prioritize Search CPU
            if (window.hHandshake) clearInterval(window.hHandshake);
            
            const res = await youtubeSearch(val);
            resultsGrid.innerHTML = '';
            renderCards(res, 'search-results');
        }, 600);
    });
}
// --- 6. PLAYER ENGINE (CORE) ---
// Premium Web-native engine stabilized.
