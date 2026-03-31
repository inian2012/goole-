document.addEventListener('DOMContentLoaded', () => {
    window.onerror = function(msg, source, lineno, colno, error) {
        showToast("Error: " + msg + " (L" + lineno + ")");
    };

    // --- State Management ---
    const STORAGE_KEY = 'acctVaultData';
    const THEME_KEY = 'acctVaultTheme';
    const GITHUB_TOKEN_KEY = 'acctvault_gh_token';
    const GITHUB_GIST_ID_KEY = 'acctvault_gh_gist_id';
    
    let githubToken = localStorage.getItem(GITHUB_TOKEN_KEY) || '';
    let githubGistId = localStorage.getItem(GITHUB_GIST_ID_KEY) || '';
    let isSyncing = false;
    let syncQueued = false; // Queue indicator for rapid changes
    
    // Default Data Structure
    let state = {
        categories: [
            { id: 'default', name: '默认分类', cards: [] }
        ],
        trash: [], // New trash array
        currentCategoryId: 'default',
        currentCardIndex: 0
    };

    // --- DOM Elements ---
    const dom = {
        categoryList: document.getElementById('category-list'),
        currentCategoryTitle: document.getElementById('current-category-title'),
        cardCount: document.getElementById('card-count'),
        cardStack: document.getElementById('card-stack'),
        emptyState: document.getElementById('empty-state'),
        
        // Controls
        prevBtn: document.getElementById('prev-card-btn'),
        nextBtn: document.getElementById('next-card-btn'),
        currIndexSpan: document.getElementById('current-card-index'),
        totIndexSpan: document.getElementById('total-card-index'),
        
        // Buttons
        addCategoryBtn: document.getElementById('add-category-btn'),
        deleteCategoryBtn: document.getElementById('delete-category-btn'),
        addDataBtn: document.getElementById('addDataBtn'), // check index.html it's add-data-btn
        addCardBtn: document.getElementById('add-data-btn'),
        exportImportBtn: document.getElementById('export-import-btn'),
        themeSwitch: document.getElementById('theme-switch'),
        
        // Modals
        categoryModal: document.getElementById('category-modal'),
        dataModal: document.getElementById('data-modal'),
        backupModal: document.getElementById('backup-modal'),
        syncModal: document.getElementById('sync-modal'),
        
        // Sync UI
        syncSettingsBtn: document.getElementById('sync-settings-btn'),
        syncStatus: document.getElementById('sync-status'),
        syncStatusText: document.querySelector('#sync-status .status-text'),
        githubLatency: document.querySelector('#github-latency span'),
        githubLatencyIcon: document.querySelector('#github-latency i'),
        githubTokenInput: document.getElementById('github-token'),
        githubGistIdInput: document.getElementById('github-gist-id'),
        saveSyncBtn: document.getElementById('save-sync-btn'),
        disconnectSyncBtn: document.getElementById('disconnect-sync-btn'),
        syncErrorMsg: document.getElementById('sync-error-msg'),
        
        // Mobile & Sidebar
        sidebar: document.querySelector('.sidebar'),
        mobileMenuBtn: document.getElementById('mobile-menu-btn'),
        
        // Trash UI
        emptyTrashBtn: document.getElementById('empty-trash-btn'),
        deleteCategoryBtn: document.getElementById('delete-category-btn'),
        
        // Inputs
        newCategoryInput: document.getElementById('new-category-name'),
        dataInputArea: document.getElementById('data-input'),
        targetCategoryName: document.getElementById('target-category-name'),
        parseStatus: document.getElementById('parse-status'),
        importInput: document.getElementById('import-file-input'),
        
        // Modal Actions
        saveCategoryBtn: document.getElementById('save-category-btn'),
        saveDataBtn: document.getElementById('save-data-btn'),
        exportDataBtn: document.getElementById('export-data-btn'),
        
        // Toast/Audio
        toast: document.getElementById('toast'),
        clickSound: document.getElementById('click-sound')
    };

    // Mobile Overlay Setup
    const mobileOverlay = document.createElement('div');
    mobileOverlay.className = 'mobile-overlay';
    document.body.appendChild(mobileOverlay);
    dom.mobileOverlay = mobileOverlay;

    // --- Initialization ---
    init();

    function init() {
        loadData();
        if(!state.trash) state.trash = []; // Migrate legacy state
        loadTheme();
        bindEvents();
        updateSyncStatusUI();
        startPingGitHub(); // Start latency checker
        
        if (githubToken && githubGistId) {
            fetchFromCloud(true);
        } else {
            render();
        }
    }

    function loadData() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.categories && parsed.categories.length > 0) {
                    state = parsed;
                }
            } catch (e) {
                console.error("Failed to parse local storage data.");
            }
        }
    }

    function saveData() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        syncToCloud();
    }

    function loadTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
        if (savedTheme === 'light') {
            document.body.setAttribute('data-theme', 'light');
            dom.themeSwitch.checked = false;
        } else {
            document.body.removeAttribute('data-theme');
            dom.themeSwitch.checked = true;
        }
    }

    function toggleTheme() {
        if (dom.themeSwitch.checked) {
            document.body.removeAttribute('data-theme');
            localStorage.setItem(THEME_KEY, 'dark');
        } else {
            document.body.setAttribute('data-theme', 'light');
            localStorage.setItem(THEME_KEY, 'light');
        }
    }

    function playSound() {
        dom.clickSound.currentTime = 0;
        dom.clickSound.volume = 0.2;
        dom.clickSound.play().catch(e => { /* Ignore autoplay blocks */ });
    }

    function showToast(message) {
        dom.toast.textContent = message;
        dom.toast.classList.remove('hidden');
        setTimeout(() => {
            dom.toast.classList.add('hidden');
        }, 3000);
    }

    // --- Network Latency Check ---
    function startPingGitHub() {
        if (!dom.githubLatency) return;
        
        function ping() {
            const start = Date.now();
            const img = new Image();
            img.onload = () => {
                const latency = Date.now() - start;
                updateLatencyUI(latency);
            };
            img.onerror = () => {
                updateLatencyUI(-1); // Failed
            };
            // Fetch small static asset to avoid API rate limits
            img.src = 'https://github.githubassets.com/favicon.ico?_t=' + start;
        }

        ping(); // Run immediately
        setInterval(ping, 10000); // Check every 10 seconds
    }

    function updateLatencyUI(latency) {
        if (latency === -1) {
            dom.githubLatency.textContent = '超时/断网';
            dom.githubLatencyIcon.style.color = 'var(--danger-color)';
        } else {
            dom.githubLatency.textContent = latency + ' ms';
            if (latency <= 150) {
                dom.githubLatencyIcon.style.color = '#10b981'; // Emerald/Green - Good
            } else if (latency <= 400) {
                dom.githubLatencyIcon.style.color = '#f59e0b'; // Amber/Yellow - Moderate
            } else {
                dom.githubLatencyIcon.style.color = 'var(--danger-color)'; // Red - Slow
            }
        }
    }

    // --- Cloud Sync Logic ---
    function updateSyncStatusUI(statusStr = null) {
        if (!githubToken) {
            dom.syncStatus.className = 'sync-status offline';
            dom.syncStatusText.textContent = '无同步';
            return;
        }
        
        if (statusStr === 'syncing') {
            dom.syncStatus.className = 'sync-status syncing';
            dom.syncStatusText.textContent = '同步中...';
        } else if (statusStr === 'error') {
            dom.syncStatus.className = 'sync-status error';
            dom.syncStatusText.textContent = '同步失败';
        } else {
            dom.syncStatus.className = 'sync-status online';
            dom.syncStatusText.textContent = '已同步';
        }
    }

    async function syncToCloud() {
        if (!githubToken || !githubGistId) return;
        
        if (isSyncing) {
            syncQueued = true;
            return;
        }
        
        isSyncing = true;
        updateSyncStatusUI('syncing');
        
        try {
            const response = await fetch(`https://api.github.com/gists/${githubGistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    files: {
                        'acctvault_data.json': {
                            content: JSON.stringify(state)
                        }
                    }
                })
            });
            
            if (!response.ok) throw new Error('API Request Failed');
            
            updateSyncStatusUI('online');
        } catch (error) {
            console.error('Sync failed:', error);
            updateSyncStatusUI('error');
        } finally {
            isSyncing = false;
            // If another change happened while we were syncing, trigger sync again
            if (syncQueued) {
                syncQueued = false;
                syncToCloud();
            }
        }
    }

    async function fetchFromCloud(initialLoad = false) {
        if (!githubToken || !githubGistId) return;
        
        updateSyncStatusUI('syncing');
        try {
            const response = await fetch(`https://api.github.com/gists/${githubGistId}`, {
                headers: {
                    'Authorization': `Bearer ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (!response.ok) throw new Error('Failed to fetch from cloud');
            
            const gist = await response.json();
            const file = gist.files['acctvault_data.json'];
            
            if (file && file.content) {
                const cloudData = JSON.parse(file.content);
                if (cloudData.categories) {
                    state = cloudData;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                    if (initialLoad) {
                        showToast('成功连接并拉取云端数据');
                    }
                    render();
                }
            }
            updateSyncStatusUI('online');
        } catch (error) {
            console.error('Fetch failed:', error);
            updateSyncStatusUI('error');
            if (initialLoad) {
               showToast('由于网络原因拉取云端失败，加载本地数据');
               render();
            }
        }
    }

    async function initializeCloudSync(token, existingGistId) {
        dom.syncErrorMsg.textContent = '正在连接 GitHub...';
        dom.syncErrorMsg.style.color = 'var(--text-primary)';
        dom.saveSyncBtn.disabled = true;
        
        try {
            if (existingGistId) {
                // Verify existing gist
                const response = await fetch(`https://api.github.com/gists/${existingGistId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                
                if (!response.ok) {
                    if(response.status === 401) throw new Error('Token 无效或已过期(401)');
                    if(response.status === 404) throw new Error('Gist ID 不存在或无权限访问(404)');
                    throw new Error(`连接失败 (HTTP ${response.status})`);
                }
                
                githubToken = token;
                githubGistId = existingGistId;
                localStorage.setItem(GITHUB_TOKEN_KEY, token);
                localStorage.setItem(GITHUB_GIST_ID_KEY, existingGistId);
                
                // Fetch data to overwrite local
                await fetchFromCloud(true);
                
            } else {
                // Create a new gist
                const response = await fetch('https://api.github.com/gists', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        description: 'AcctVault Cloud Database (Private)',
                        public: false,
                        files: {
                            'acctvault_data.json': {
                                content: JSON.stringify(state)
                            }
                        }
                    })
                });
                
                if (!response.ok) {
                    if (response.status === 401) throw new Error('Token 无效，请检查权限是否勾选了 gist (401)');
                    throw new Error('创建 Gist 失败');
                }
                
                const gist = await response.json();
                githubToken = token;
                githubGistId = gist.id;
                localStorage.setItem(GITHUB_TOKEN_KEY, token);
                localStorage.setItem(GITHUB_GIST_ID_KEY, githubGistId);
                
                showToast('已在云端创建数据库并上传');
                updateSyncStatusUI('online');
            }
            
            closeModal(dom.syncModal);
            dom.saveSyncBtn.disabled = false;
            dom.syncErrorMsg.textContent = '';
            
        } catch (error) {
            dom.syncErrorMsg.textContent = error.message;
            dom.syncErrorMsg.style.color = 'var(--danger-color)';
            dom.saveSyncBtn.disabled = false;
        }
    }


    // --- Core Logic ---
    
    function getCurrentCategory() {
        if (state.currentCategoryId === 'trash') {
            return { id: 'trash', name: '回收站', cards: state.trash };
        }
        return state.categories.find(c => c.id === state.currentCategoryId) || state.categories[0];
    }

    function generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    function addCategory(name) {
        const newCat = { id: 'cat_' + generateId(), name: name.trim(), cards: [] };
        state.categories.push(newCat);
        state.currentCategoryId = newCat.id;
        state.currentCardIndex = 0;
        saveData();
        render();
        closeModal(dom.categoryModal);
        showToast('分类创建成功');
    }

    function deleteCategory() {
        if (state.categories.length <= 1) {
            showToast('至少保留一个分类');
            return;
        }
        if (confirm('确定要删除当前分类及其所有数据吗？此操作不可逆转！')) {
            state.categories = state.categories.filter(c => c.id !== state.currentCategoryId);
            state.currentCategoryId = state.categories[0].id;
            state.currentCardIndex = 0;
            saveData();
            render();
            showToast('分类已删除');
        }
    }

    function parseAndAddData(rawText) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let addedCount = 0;
        
        const cat = getCurrentCategory();
        if (cat.id === 'trash') return; // Cannot add to trash
        
        lines.forEach(line => {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length > 0) {
                const card = {
                    id: 'card_' + generateId(),
                    originalCategoryId: cat.id,
                    raw: line,
                    parsed: {
                        email: parts[0] || 'N/A',
                        password: parts[1] || 'N/A',
                        backupEmail: parts[2] || 'N/A',
                        token: parts[3] || 'N/A',
                        country: parts[4] || 'N/A'
                    }
                };
                cat.cards.push(card);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            saveData();
            state.currentCardIndex = 0;
            render();
            closeModal(dom.dataModal);
            showToast(`成功导入 ${addedCount} 条数据`);
            dom.dataInputArea.value = '';
        } else {
            dom.parseStatus.textContent = "未发现有效数据行";
            dom.parseStatus.style.color = "var(--danger-color)";
        }
    }

    function deleteCard(cardId) {
        let cat = getCurrentCategory();
        
        if (cat.id !== 'trash') {
            // Move to trash
            const cardIdx = cat.cards.findIndex(c => c.id === cardId);
            if (cardIdx !== -1) {
                const card = cat.cards.splice(cardIdx, 1)[0];
                state.trash.unshift(card); // Add to top of trash
            }
        } else {
            // Permanent delete from trash
            if(confirm("将彻底删除该卡片无法恢复，是否继续？")) {
                state.trash = state.trash.filter(c => c.id !== cardId);
            } else {
                return;
            }
        }
        
        if (state.currentCardIndex >= cat.cards.length) {
            state.currentCardIndex = Math.max(0, cat.cards.length - 1);
        }
        
        saveData();
        render();
        playSound();
    }
    
    function restoreCard(cardId) {
        const cardIdx = state.trash.findIndex(c => c.id === cardId);
        if (cardIdx !== -1) {
            const card = state.trash.splice(cardIdx, 1)[0];
            const targetCat = state.categories.find(c => c.id === card.originalCategoryId) || state.categories[0];
            targetCat.cards.unshift(card);
            
            saveData();
            render();
            playSound();
            showToast('卡片已恢复到: ' + targetCat.name);
        }
    }
    
    function emptyTrash() {
        if(state.trash.length === 0) return;
        if(confirm(`确定要彻底清空回收站里的 ${state.trash.length} 张卡片吗？`)) {
            state.trash = [];
            state.currentCardIndex = 0;
            saveData();
            render();
            showToast('回收站已清空');
        }
    }

    function copyText(text, isCardAction = false) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('已复制到剪贴板！');
            if(isCardAction) playSound();
        }).catch(err => {
            showToast('复制失败: ' + err);
        });
    }

    // --- Rendering ---
    
    function render() {
        renderSidebar();
        renderMainHeader();
        renderStack();
    }

    function renderSidebar() {
        dom.categoryList.innerHTML = '';
        state.categories.forEach(cat => {
            const li = document.createElement('li');
            li.className = `category-item ${cat.id === state.currentCategoryId ? 'active' : ''}`;
            li.innerHTML = `<i class="fa-solid ${cat.id === 'default' ? 'fa-folder' : 'fa-folder-closed'}"></i> ${cat.name}`;
            li.onclick = () => {
                state.currentCategoryId = cat.id;
                state.currentCardIndex = 0;
                saveData();
                closeMobileSidebar();
                render();
            };
            dom.categoryList.appendChild(li);
        });
        
        // Append Divider
        const divider = document.createElement('div');
        divider.className = 'category-divider';
        dom.categoryList.appendChild(divider);
        
        // Append Trash Category
        const trashLi = document.createElement('li');
        trashLi.className = `category-item special-category ${state.currentCategoryId === 'trash' ? 'active' : ''}`;
        trashLi.innerHTML = `<i class="fa-solid fa-trash-can"></i> 回收站 <span class="badge" style="margin-left:auto;">${state.trash.length}</span>`;
        trashLi.onclick = () => {
            state.currentCategoryId = 'trash';
            state.currentCardIndex = 0;
            saveData();
            closeMobileSidebar();
            render();
        };
        dom.categoryList.appendChild(trashLi);
    }

    function renderMainHeader() {
        const cat = getCurrentCategory();
        dom.currentCategoryTitle.textContent = cat.name;
        dom.cardCount.textContent = `${cat.cards.length} 张卡片`;
        dom.targetCategoryName.textContent = cat.name;
        
        if (cat.id === 'trash') {
            dom.deleteCategoryBtn.classList.add('hidden');
            dom.addCardBtn.classList.add('hidden');
            if(state.trash.length > 0) dom.emptyTrashBtn.classList.remove('hidden');
            else dom.emptyTrashBtn.classList.add('hidden');
        } else {
            dom.deleteCategoryBtn.classList.remove('hidden');
            dom.addCardBtn.classList.remove('hidden');
            dom.emptyTrashBtn.classList.add('hidden');
        }
    }

    function renderStack() {
        const cat = getCurrentCategory();
        const cards = cat.cards;
        
        dom.cardStack.innerHTML = '';
        
        if (cards.length === 0) {
            dom.emptyState.classList.remove('hidden');
            dom.cardStack.style.display = 'none';
            updateControls(0, 0);
            return;
        } else {
            dom.emptyState.classList.add('hidden');
            dom.cardStack.style.display = 'block';
        }

        updateControls(state.currentCardIndex + 1, cards.length);

        // Render backwards to manage z-index naturally in DOM, 
        // but we'll use absolute positioning and specific z-index
        cards.forEach((card, index) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'data-card';
            
            // Calculate 3D Math Based on Current Index
            const diff = index - state.currentCardIndex;
            
            if (diff < 0) {
                // Card has been Swiped Away (Above/Left)
                cardEl.style.transform = `translateY(-150px) scale(0.8)`;
                cardEl.style.opacity = '0';
                cardEl.style.zIndex = -1;
                cardEl.style.pointerEvents = 'none';
            } else if (diff === 0) {
                // Current Card
                cardEl.classList.add('card-front');
                cardEl.style.transform = `translateZ(0px) translateY(0px) scale(1)`;
                cardEl.style.opacity = '1';
                cardEl.style.zIndex = 100;
            } else if (diff <= 3) {
                // Upcoming Cards creating stack effect
                const scale = 1 - (diff * 0.05);
                const translateY = diff * 20; // Move down slightly
                cardEl.style.transform = `translateY(${translateY}px) scale(${scale})`;
                cardEl.style.opacity = 1 - (diff * 0.2); // Fade out as it goes back
                cardEl.style.zIndex = 100 - diff;
                cardEl.style.pointerEvents = 'none'; // Only interact with top card
            } else {
                // Hidden deep in stack
                cardEl.style.opacity = '0';
                cardEl.style.pointerEvents = 'none';
            }

            // Build Card HTML
            const isTrash = state.currentCategoryId === 'trash';
            
            cardEl.innerHTML = `
                <div class="card-index">${index + 1}</div>
                
                <div class="card-field">
                    <span class="field-label"><i class="fa-solid fa-envelope"></i> 账号/主邮箱</span>
                    <div class="field-value">
                        <span>${card.parsed.email}</span>
                        <button class="copy-inline-btn" data-copy="${card.parsed.email}"><i class="fa-regular fa-copy"></i></button>
                    </div>
                </div>
                
                <div class="card-field">
                    <span class="field-label"><i class="fa-solid fa-key"></i> 密码</span>
                    <div class="field-value">
                        <span>${card.parsed.password}</span>
                        <button class="copy-inline-btn" data-copy="${card.parsed.password}"><i class="fa-regular fa-copy"></i></button>
                    </div>
                </div>
                
                <div style="display: flex; gap: 16px;">
                    <div class="card-field" style="flex:1;">
                        <span class="field-label"><i class="fa-solid fa-shield-halved"></i> 辅助邮箱</span>
                        <div class="field-value" style="font-size: 0.9rem;">
                            <span>${card.parsed.backupEmail}</span>
                            <button class="copy-inline-btn" data-copy="${card.parsed.backupEmail}"><i class="fa-regular fa-copy"></i></button>
                        </div>
                    </div>
                     <div class="card-field" style="flex:1;">
                        <span class="field-label"><i class="fa-solid fa-fingerprint"></i> Token / Key</span>
                        <div class="field-value" style="font-size: 0.9rem;">
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80px;" title="${card.parsed.token}">${card.parsed.token}</span>
                            <button class="copy-inline-btn" data-copy="${card.parsed.token}"><i class="fa-regular fa-copy"></i></button>
                        </div>
                    </div>
                </div>
                
                <div class="card-field">
                    <span class="field-label"><i class="fa-solid fa-globe"></i> 归属地</span>
                    <div class="field-value" style="font-size: 0.9rem; padding: 8px 16px;">
                        <span>${card.parsed.country}</span>
                    </div>
                </div>
                
                <div class="card-actions">
                    ${isTrash ? 
                        `<button class="primary-btn btn-restore" data-id="${card.id}" style="flex:1"><i class="fa-solid fa-rotate-left"></i> 恢复</button>` : 
                        `<button class="copy-all-btn btn-copy-raw" data-copy="${card.raw}"><i class="fa-solid fa-copy"></i> 复制原数据</button>`
                    }
                    <button class="delete-card-btn" data-id="${card.id}"><i class="fa-solid ${isTrash?'fa-dumpster':'fa-trash'}"></i> ${isTrash?'彻底删除':'删除'}</button>
                </div>
            `;
            
            dom.cardStack.appendChild(cardEl);
        });

        // Bind Card Events
        const topCard = dom.cardStack.querySelector('.card-front');
        if (topCard) {
            bindSwipeEvents(topCard); // Mobile Swipe Binding
            
            topCard.querySelectorAll('.copy-inline-btn, .btn-copy-raw').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    copyText(btn.getAttribute('data-copy'), true);
                });
            });
            
            if(state.currentCategoryId === 'trash') {
                const restoreBtn = topCard.querySelector('.btn-restore');
                if(restoreBtn) restoreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    restoreCard(e.currentTarget.getAttribute('data-id'));
                });
            }
            
            topCard.querySelector('.delete-card-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCard(e.currentTarget.getAttribute('data-id'));
            });
        }
    }

    function updateControls(current, total) {
        dom.currIndexSpan.textContent = current;
        dom.totIndexSpan.textContent = total;
        
        dom.prevBtn.disabled = current <= 1;
        dom.nextBtn.disabled = current >= total;
    }

    function switchCard(direction) {
        const cat = getCurrentCategory();
        if (direction === 'next' && state.currentCardIndex < cat.cards.length - 1) {
            state.currentCardIndex++;
            playSound();
            renderStack();
        } else if (direction === 'prev' && state.currentCardIndex > 0) {
            state.currentCardIndex--;
            playSound();
            renderStack();
        }
    }

    // --- Mobile Swipe logic ---
    let swipeStartX = 0;
    let swipeCurrentX = 0;
    
    function bindSwipeEvents(cardEl) {
        cardEl.addEventListener('touchstart', e => {
            swipeStartX = e.touches[0].clientX;
            cardEl.classList.add('swiping');
        }, {passive: true});
        
        cardEl.addEventListener('touchmove', e => {
            swipeCurrentX = e.touches[0].clientX;
            const deltaX = swipeCurrentX - swipeStartX;
            // Add some rotation based on X movement
            const rotate = deltaX * 0.05;
            cardEl.style.transform = `translate3d(${deltaX}px, 0, 0) rotate(${rotate}deg)`;
        }, {passive: true});
        
        cardEl.addEventListener('touchend', e => {
            cardEl.classList.remove('swiping');
            const deltaX = swipeCurrentX - swipeStartX;
            
            // Check threshold for swipe actions
            if (deltaX < -100) {
                // Swiped Left -> go Next
                switchCard('next');
            } else if (deltaX > 100) {
                // Swiped Right -> go Prev (if not first)
                if (state.currentCardIndex > 0) {
                    switchCard('prev');
                } else {
                     // bounce back
                    cardEl.style.transform = `translateZ(0px) translateY(0px) scale(1)`;
                }
            } else {
                // Bounce back
                cardEl.style.transform = `translateZ(0px) translateY(0px) scale(1)`;
            }
            swipeStartX = 0;
            swipeCurrentX = 0;
        });
    }

    // --- Modal Logic ---
    function openModal(modalEl) {
        modalEl.classList.remove('hidden');
    }
    
    function closeModal(modalEl) {
        modalEl.classList.add('hidden');
    }

    function closeMobileSidebar() {
        if(window.innerWidth <= 768) {
            dom.sidebar.classList.remove('open');
            dom.mobileOverlay.classList.remove('active');
        }
    }

    // --- Event Bindings ---
    function bindEvents() {
        // Theme
        dom.themeSwitch.addEventListener('change', toggleTheme);
        
        // Mobile Sidebar
        dom.mobileMenuBtn.addEventListener('click', () => {
            dom.sidebar.classList.add('open');
            dom.mobileOverlay.classList.add('active');
        });
        dom.mobileOverlay.addEventListener('click', closeMobileSidebar);
        
        // Navigation
        dom.prevBtn.addEventListener('click', () => switchCard('prev'));
        dom.nextBtn.addEventListener('click', () => switchCard('next'));
        
        // Keyboard Nav
        document.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') switchCard('next');
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') switchCard('prev');
        });

        // Top Header Actions
        dom.deleteCategoryBtn.addEventListener('click', deleteCategory);
        dom.emptyTrashBtn.addEventListener('click', emptyTrash);
        
        dom.addCardBtn.addEventListener('click', () => {
            dom.parseStatus.textContent = '';
            openModal(dom.dataModal);
            dom.dataInputArea.focus();
        });

        // Sidebar Actions
        dom.addCategoryBtn.addEventListener('click', () => {
            closeMobileSidebar();
            dom.newCategoryInput.value = '';
            openModal(dom.categoryModal);
            dom.newCategoryInput.focus();
        });
        dom.exportImportBtn.addEventListener('click', () => {
            closeMobileSidebar();
            openModal(dom.backupModal);
        });
        
        window.openSyncSettings = () => {
            closeMobileSidebar(); // Important: clear modal z-index overlap
            dom.githubTokenInput.value = githubToken;
            dom.githubGistIdInput.value = githubGistId;
            dom.syncErrorMsg.textContent = '';
            
            if (githubToken) {
                dom.disconnectSyncBtn.classList.remove('hidden');
                dom.saveSyncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> 更新配置并重新同步';
            } else {
                dom.disconnectSyncBtn.classList.add('hidden');
                dom.saveSyncBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 保存并初始化同步';
            }
            openModal(dom.syncModal);
        };
        dom.syncSettingsBtn.addEventListener('click', window.openSyncSettings);

        // Sync Modal Actions
        dom.saveSyncBtn.addEventListener('click', () => {
            const token = dom.githubTokenInput.value.trim();
            const gistId = dom.githubGistIdInput.value.trim();
            
            if (!token) {
                dom.syncErrorMsg.textContent = "Token 不能为空";
                dom.syncErrorMsg.style.color = 'var(--danger-color)';
                return;
            }
            initializeCloudSync(token, gistId);
        });

        dom.disconnectSyncBtn.addEventListener('click', () => {
             if (confirm("断开连接后，本地数据和云端数据将不再同步（旧数据不会丢失）。确认断开吗？")) {
                githubToken = '';
                githubGistId = '';
                localStorage.removeItem(GITHUB_TOKEN_KEY);
                localStorage.removeItem(GITHUB_GIST_ID_KEY);
                updateSyncStatusUI('offline');
                closeModal(dom.syncModal);
                showToast('云端同步已断开');
             }
        });

        // Modal Close Buttons
        document.querySelectorAll('.close-modal, .cancel-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                closeModal(e.target.closest('.modal-overlay'));
            });
        });
        
        // Modal Overlay Click (Close)
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModal(overlay);
            });
        });

        // Category Save
        dom.saveCategoryBtn.addEventListener('click', () => {
            const val = dom.newCategoryInput.value;
            if (val.trim()) addCategory(val);
        });
        dom.newCategoryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') dom.saveCategoryBtn.click();
        });

        // Data Save
        dom.saveDataBtn.addEventListener('click', () => {
             parseAndAddData(dom.dataInputArea.value);
        });

        // Export/Import
        dom.exportDataBtn.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `AcctVault_Backup_${new Date().toISOString().slice(0,10)}.json`);
            document.body.appendChild(downloadAnchorNode); // required for firefox
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            showToast('已导出备份文件');
            closeModal(dom.backupModal);
        });

        dom.importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    if (parsed && parsed.categories) {
                        state = parsed;
                        saveData();
                        render();
                        showToast('数据恢复成功');
                        closeModal(dom.backupModal);
                    } else {
                        showToast('无效的备份文件');
                    }
                } catch (err) {
                    showToast('文件解析失败');
                }
            };
            reader.readAsText(file);
            dom.importInput.value = ''; // Reset
        });
    }
});
