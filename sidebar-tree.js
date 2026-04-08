// ============================================================================
// sidebar-tree.js — Folder tree sidebar, resize, expand/collapse
// Extracted from renderer.js. All functions/variables remain in global scope.
// ============================================================================

// ============================================================================
// FOLDER TREE SIDEBAR
// ============================================================================

let sidebarWidth = parseInt(localStorage.getItem('sidebarWidth')) || 260;
let sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
let sidebarTabFilterActive = localStorage.getItem('sidebarTabFilterActive') === 'true';
let sidebarTabFilterFlat = localStorage.getItem('sidebarTabFilterFlat') === 'true';
let sidebarTabFilterBtn = null;
let sidebarTabFlatBtn = null;
let sidebarLayoutSyncTimeout = null;
let sidebarTransitionEndHandler = null;
let sidebarExpandedNodes;
try {
    sidebarExpandedNodes = new Set(JSON.parse(localStorage.getItem('sidebarExpandedNodes') || '[]'));
} catch (e) {
    console.warn('Failed to parse sidebarExpandedNodes from localStorage, resetting:', e);
    localStorage.removeItem('sidebarExpandedNodes');
    sidebarExpandedNodes = new Set();
}

function saveSidebarExpandedNodes() {
    deferLocalStorageWrite('sidebarExpandedNodes', JSON.stringify([...sidebarExpandedNodes]));
}

function createTreeNode(item, depth, isDrive = false) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.path = item.path;
    node.dataset.depth = depth;
    if (isDrive) node.dataset.drive = '1';

    const row = document.createElement('div');
    row.className = 'tree-node-row';
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    // Toggle arrow
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle' + (item.hasChildren === false && !isDrive ? ' no-children' : '');
    toggle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

    // Folder icon
    const icon = document.createElement('span');
    icon.className = 'tree-node-icon';
    if (isDrive) {
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>';
    } else {
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>';
    }

    // Label
    const label = document.createElement('span');
    label.className = 'tree-node-label';
    label.textContent = item.name;
    label.title = item.path;

    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(label);

    // Children container
    const children = document.createElement('div');
    children.className = 'tree-children';

    node.appendChild(row);
    node.appendChild(children);

    // Click on row navigates to folder
    row.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        if (e.target.closest('.tree-toggle') && (item.hasChildren !== false || isDrive)) {
            toggleTreeNode(node, depth, isDrive);
        } else {
            // Instantly highlight the clicked row before async navigation begins
            if (sidebarTree) {
                const prevActive = sidebarTree.querySelector('.tree-node-row.active');
                if (prevActive) prevActive.classList.remove('active');
            }
            row.classList.add('active');
            navigateToFolder(item.path);
        }
    });

    // Hover prefetch — start a lightweight folder scan after 200ms hover
    let _sidebarPrefetchTimer = null;
    row.addEventListener('mouseenter', () => {
        _sidebarPrefetchTimer = setTimeout(() => {
            if (typeof prefetchFolderIfNeeded === 'function') {
                prefetchFolderIfNeeded(item.path);
            }
        }, 200);
    });
    row.addEventListener('mouseleave', () => {
        clearTimeout(_sidebarPrefetchTimer);
        _sidebarPrefetchTimer = null;
    });

    // Middle-click opens folder in new tab
    row.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
            e.preventDefault();
        }
    });
    row.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            const displayName = item.path.split(/[/\\]/).pop();
            createTab(item.path, displayName);
        }
    });

    // Right-click context menu (reuse folder context menu)
    if (!isDrive) {
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Create a lightweight proxy element so the existing folder context menu handler works
            const proxy = document.createElement('div');
            proxy.classList.add('folder-card');
            proxy.dataset.folderPath = item.path;
            showContextMenu(e, proxy);
        });
    }

    // Double-click toggle to expand
    toggle.addEventListener('dblclick', (e) => e.stopPropagation());

    return node;
}

/** Load or reload subdirectory rows under a tree node (used by expand and by FS watch refresh). */
async function loadTreeNodeChildren(node, depth, isDrive = false, { forceReload = false } = {}) {
    const children = node.querySelector('.tree-children');
    const toggle = node.querySelector('.tree-toggle');
    const nodePath = node.dataset.path;

    if (forceReload) {
        delete children.dataset.loaded;
        children.innerHTML = '';
        toggle.classList.remove('no-children');
    }

    if (children.dataset.loaded === '1') return;

    const loading = document.createElement('div');
    loading.className = 'tree-loading';
    loading.textContent = 'Loading...';
    children.appendChild(loading);

    try {
        const _ipcT0 = performance.now();
        const _subRes = await window.electronAPI.listSubdirectories(nodePath);
        const subdirs = _subRes && _subRes.ok ? (_subRes.value || []) : [];
        console.log(`[sidebar] listSubdirectories "${nodePath.split(/[\\/]/).pop()}" (${subdirs.length} dirs): ${(performance.now() - _ipcT0).toFixed(1)}ms`);
        children.innerHTML = '';
        children.dataset.loaded = '1';

        // Collect children that need re-expansion so we can await them sequentially
        // (firing all at once causes a thundering herd of IPC calls on 10+ subfolders)
        const toExpand = [];
        for (const subdir of subdirs) {
            const childNode = createTreeNode(subdir, depth + 1);
            children.appendChild(childNode);
            if (sidebarExpandedNodes.has(subdir.path)) {
                toExpand.push({ childNode, name: subdir.name });
            }
        }
        for (const { childNode, name } of toExpand) {
            const _reT0 = performance.now();
            await toggleTreeNode(childNode, depth + 1);
            console.log(`[sidebar] re-expand "${name}": ${(performance.now() - _reT0).toFixed(1)}ms`);
        }
        if (subdirs.length === 0) {
            toggle.classList.remove('expanded');
            toggle.classList.add('no-children');
            children.classList.remove('expanded');
            sidebarExpandedNodes.delete(nodePath);
            saveSidebarExpandedNodes();
        }
    } catch (err) {
        children.innerHTML = '';
        toggle.classList.remove('expanded');
        toggle.classList.add('no-children');
        children.classList.remove('expanded');
        sidebarExpandedNodes.delete(nodePath);
        saveSidebarExpandedNodes();
    }
}

async function toggleTreeNode(node, depth, isDrive = false) {
    const children = node.querySelector('.tree-children');
    const toggle = node.querySelector('.tree-toggle');
    const nodePath = node.dataset.path;

    if (children.classList.contains('expanded')) {
        // Collapse
        children.classList.remove('expanded');
        toggle.classList.remove('expanded');
        sidebarExpandedNodes.delete(nodePath);
        saveSidebarExpandedNodes();
        return;
    }

    // Expand
    toggle.classList.add('expanded');
    children.classList.add('expanded');
    sidebarExpandedNodes.add(nodePath);
    saveSidebarExpandedNodes();

    if (children.dataset.loaded === '1') return;

    await loadTreeNodeChildren(node, depth, isDrive);
}

/** Parent directory of a file system path (handles / and Windows roots). */
function sidebarParentDirPath(filePath) {
    if (!filePath) return null;
    const norm = filePath.replace(/\\/g, '/');
    const trimmed = norm.replace(/\/+$/, '');
    if (!trimmed) return null;
    const lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash <= 0) {
        if (trimmed.startsWith('/') && trimmed.length > 1) return '/';
        if (/^[a-zA-Z]:$/.test(trimmed)) return null;
        if (/^[a-zA-Z]:\//.test(trimmed)) return trimmed.slice(0, 2) + '/';
        return null;
    }
    const parent = trimmed.slice(0, lastSlash) || '/';
    if (/^[a-zA-Z]:$/.test(parent)) return parent + '/';
    return parent;
}

window.sidebarParentDirPath = sidebarParentDirPath;

/**
 * When subfolders are added/removed on disk, reload the expanded tree node that lists them.
 * Called from folder-changed (addDir/unlinkDir) for paths under the watched folder.
 */
async function refreshSidebarTreeBranchForParentPath(parentPath) {
    if (!parentPath || !sidebarTree) return;
    if (sidebarTabFilterActive) return; // Filesystem changes don't affect filtered view
    const target = sidebarNormalize(parentPath);

    for (const node of sidebarTree.querySelectorAll('.tree-node')) {
        if (sidebarNormalize(node.dataset.path) !== target) continue;
        const children = node.querySelector('.tree-children');
        if (!children.classList.contains('expanded')) return;

        const depth = parseInt(node.dataset.depth, 10) || 0;
        const isDrive = node.dataset.drive === '1';
        await loadTreeNodeChildren(node, depth, isDrive, { forceReload: true });
        return;
    }
}

window.refreshSidebarTreeBranchForParentPath = refreshSidebarTreeBranchForParentPath;

// Normalize a path for sidebar comparisons — lowercase, forward slashes, no trailing slash
function sidebarNormalize(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function sidebarHighlightActive(folderPath) {
    if (!folderPath || !sidebarTree) return;
    const target = sidebarNormalize(folderPath);

    // Clear previous highlight
    const prev = sidebarTree.querySelector('.tree-node-row.active');
    if (prev) prev.classList.remove('active');

    // First try to find the node already in the DOM
    const allNodes = sidebarTree.querySelectorAll('.tree-node');
    for (const node of allNodes) {
        if (sidebarNormalize(node.dataset.path) === target) {
            const row = node.querySelector(':scope > .tree-node-row');
            if (row) {
                row.classList.add('active');
                row.scrollIntoView({ block: 'nearest' });
            }
            return;
        }
    }

    // Node not in DOM yet — expand the tree to it, then highlight.
    // Skip when tab-filter is active: the tree is already fully rendered,
    // so if the node isn't found it simply doesn't exist in the filtered set.
    if (!sidebarTabFilterActive) {
        sidebarExpandToPath(folderPath);
    }
}

async function sidebarExpandToPath(folderPath) {
    if (!folderPath || !sidebarTree) return;
    const _seT0 = performance.now();

    // In tab-filter mode the tree already shows all tab paths expanded.
    // Inline the highlight logic instead of calling sidebarHighlightActive
    // to avoid mutual recursion (sidebarHighlightActive -> sidebarExpandToPath -> ...).
    if (sidebarTabFilterActive) {
        const target = sidebarNormalize(folderPath);
        const prev = sidebarTree.querySelector('.tree-node-row.active');
        if (prev) prev.classList.remove('active');
        for (const node of sidebarTree.querySelectorAll('.tree-node')) {
            if (sidebarNormalize(node.dataset.path) === target) {
                const row = node.querySelector(':scope > .tree-node-row');
                if (row) {
                    row.classList.add('active');
                    row.scrollIntoView({ block: 'nearest' });
                }
                break;
            }
        }
        return;
    }

    // Detect Windows vs Unix path style
    const isWinPath = folderPath.includes('\\') || (folderPath.length > 1 && folderPath[1] === ':');
    const sep = isWinPath ? '\\' : '/';

    // Parse the path into segments (e.g. "C:\Users\foo" → ["C:", "Users", "foo"])
    const normalized = isWinPath ? folderPath.replace(/\//g, '\\') : folderPath;
    const parts = normalized.split(sep).filter(Boolean);
    if (parts.length === 0) return;

    // Build the root path (Windows: "C:\", Unix: "/")
    const rootPart = (isWinPath && parts[0].endsWith(':')) ? parts[0] + '\\' : '/';

    // Find the drive node
    let driveNode = null;
    for (const node of sidebarTree.querySelectorAll(':scope > .tree-node')) {
        if (sidebarNormalize(node.dataset.path) === sidebarNormalize(rootPart)) {
            driveNode = node;
            break;
        }
    }
    if (!driveNode) return;

    // Expand drive if needed
    const driveChildren = driveNode.querySelector('.tree-children');
    if (!driveChildren.classList.contains('expanded')) {
        await toggleTreeNode(driveNode, 0, true);
    }

    // Walk down the remaining path segments
    let parentContainer = driveChildren;
    let currentPath = rootPart;

    for (let i = 1; i < parts.length; i++) {
        currentPath = currentPath.replace(/[\\/]$/, '') + sep + parts[i];
        const targetNorm = sidebarNormalize(currentPath);

        // Wait a tick so freshly-appended children are queryable
        await new Promise(r => setTimeout(r, 10));

        let found = null;
        for (const node of parentContainer.querySelectorAll(':scope > .tree-node')) {
            if (sidebarNormalize(node.dataset.path) === targetNorm) {
                found = node;
                break;
            }
        }
        if (!found) break;

        // Expand intermediate segments to reveal the target folder.
        // Skip the LAST segment — its children load on demand when the user clicks
        // the expand arrow.  This avoids a costly listSubdirectories IPC call that
        // blocks the main process (hasChildren checks for every child directory).
        const childContainer = found.querySelector('.tree-children');
        if (i < parts.length - 1 && !childContainer.classList.contains('expanded')) {
            const _tT0 = performance.now();
            await toggleTreeNode(found, i);
            console.log(`[sidebar] toggleTreeNode "${parts[i]}": ${(performance.now() - _tT0).toFixed(1)}ms`);
        }
        parentContainer = childContainer;

        // On the final segment, highlight it
        if (i === parts.length - 1) {
            const prev = sidebarTree.querySelector('.tree-node-row.active');
            if (prev) prev.classList.remove('active');
            const row = found.querySelector(':scope > .tree-node-row');
            if (row) {
                row.classList.add('active');
                row.scrollIntoView({ block: 'nearest' });
            }
        }
    }
    console.log(`[sidebar] sidebarExpandToPath complete: ${(performance.now() - _seT0).toFixed(1)}ms`);
}

function initSidebarResize() {
    let isResizing = false;

    sidebarResizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        sidebarResizeHandle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    let _resizeRafPending = false;
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        if (_resizeRafPending) return;
        _resizeRafPending = true;
        const clientX = e.clientX;
        requestAnimationFrame(() => {
            _resizeRafPending = false;
            const newWidth = Math.min(sidebarMaxWidthSetting, Math.max(sidebarMinWidthSetting, clientX));
            folderSidebar.style.width = newWidth + 'px';
            sidebarWidth = newWidth;
        });
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        sidebarResizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        deferLocalStorageWrite('sidebarWidth', sidebarWidth.toString());
        scheduleSidebarLayoutSync();
    });
}

let pendingDimensionHydrationRefreshMode = null;
let pendingDimensionHydrationRefreshRaf = null;

function scheduleDimensionHydrationRefresh(mode) {
    if (mode !== 'filters' && mode !== 'layout') return;
    if (mode === 'filters' || !pendingDimensionHydrationRefreshMode) {
        pendingDimensionHydrationRefreshMode = mode;
    }
    if (pendingDimensionHydrationRefreshRaf !== null) return;

    pendingDimensionHydrationRefreshRaf = requestAnimationFrame(() => {
        pendingDimensionHydrationRefreshRaf = null;
        const refreshMode = pendingDimensionHydrationRefreshMode;
        pendingDimensionHydrationRefreshMode = null;

        if (refreshMode === 'filters') {
            applyFilters();
            return;
        }

        if (!vsState.enabled) return;
        vsState.layoutCache.itemCount = 0;
        vsRecalculate();
    });
}

function relayoutAfterSidebarWidthChange() {
    if (vsState.enabled) {
        vsRecalculate();
        return;
    }
    if (layoutMode === 'masonry') {
        scheduleMasonryLayout();
    }
}

function scheduleSidebarLayoutSync(delay = 0) {
    clearTimeout(sidebarLayoutSyncTimeout);
    sidebarLayoutSyncTimeout = setTimeout(() => {
        sidebarLayoutSyncTimeout = null;
        relayoutAfterSidebarWidthChange();
    }, delay);
}

function setSidebarCollapsed(collapsed) {
    sidebarCollapsed = collapsed;
    if (collapsed) {
        folderSidebar.classList.add('collapsed');
    } else {
        folderSidebar.classList.remove('collapsed');
    }
    // Mirror toggle button icon when sidebar is collapsed
    if (sidebarToggleBtn) sidebarToggleBtn.classList.toggle('sidebar-is-collapsed', collapsed);
    deferLocalStorageWrite('sidebarCollapsed', collapsed.toString());

    if (sidebarTransitionEndHandler) {
        folderSidebar.removeEventListener('transitionend', sidebarTransitionEndHandler);
        sidebarTransitionEndHandler = null;
    }

    // Recalculate layout after the sidebar animation settles. Keep a timeout
    // fallback as well because width changes can finish without a reliable
    // transitionend when toggled quickly.
    sidebarTransitionEndHandler = (e) => {
        if (e.target !== folderSidebar) return;
        if (e.propertyName !== 'width' && e.propertyName !== 'min-width') return;
        if (sidebarTransitionEndHandler) {
            folderSidebar.removeEventListener('transitionend', sidebarTransitionEndHandler);
            sidebarTransitionEndHandler = null;
        }
        scheduleSidebarLayoutSync();
    };
    folderSidebar.addEventListener('transitionend', sidebarTransitionEndHandler);
    scheduleSidebarLayoutSync(230);
}

// ── Tab-filter helpers ──

/** Collect unique non-null folder paths from all open tabs. */
function getTabFolderPaths() {
    const paths = new Map(); // normalizedPath -> originalPath
    for (const tab of tabs) {
        if (tab.path) paths.set(sidebarNormalize(tab.path), tab.path);
    }
    return paths;
}

/** For each tab path, walk up to the drive root and collect every ancestor. */
function buildPathAncestry(tabPathMap) {
    const allPaths = new Map(tabPathMap); // normalized -> original
    for (const [norm] of tabPathMap) {
        let current = norm;
        while (true) {
            const parent = sidebarParentDirPath(current);
            if (!parent) break;
            const normParent = sidebarNormalize(parent);
            if (allPaths.has(normParent)) break; // already traced
            allPaths.set(normParent, parent);
            current = normParent;
        }
    }
    return allPaths;
}

/** From a flat set of paths, compute root nodes and a parent→children map. */
function buildFilteredTreeStructure(allNormPaths) {
    const roots = [];
    const childrenMap = new Map(); // normalized_parent -> [normalized_child, ...]

    for (const np of allNormPaths.keys()) {
        const parent = sidebarParentDirPath(np);
        const normParent = parent ? sidebarNormalize(parent) : null;
        if (!normParent || !allNormPaths.has(normParent)) {
            roots.push(np);
        } else {
            if (!childrenMap.has(normParent)) childrenMap.set(normParent, []);
            childrenMap.get(normParent).push(np);
        }
    }

    // Sort for consistent display
    roots.sort();
    for (const [, children] of childrenMap) children.sort();

    return { roots, childrenMap };
}

/** Recursively create child nodes from the pre-computed path structure. */
function renderFilteredChildren(parentNode, parentNormPath, depth, childrenMap, allPaths) {
    const children = childrenMap.get(parentNormPath);
    if (!children || children.length === 0) return;

    const childContainer = parentNode.querySelector('.tree-children');
    childContainer.dataset.loaded = '1'; // prevent lazy-load IPC
    childContainer.classList.add('expanded');
    const toggle = parentNode.querySelector('.tree-toggle');
    toggle.classList.add('expanded');

    for (const childNorm of children) {
        const originalPath = allPaths.get(childNorm) || childNorm;
        const name = originalPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean).pop() || originalPath;
        const hasChildren = childrenMap.has(childNorm);
        const childNode = createTreeNode(
            { name, path: originalPath, hasChildren },
            depth + 1
        );
        childContainer.appendChild(childNode);
        renderFilteredChildren(childNode, childNorm, depth + 1, childrenMap, allPaths);
    }
}

/** Render the sidebar tree showing only folders for open tabs. */
async function renderTabFilteredTree() {
    if (!sidebarTree) return;
    sidebarTree.innerHTML = '';

    const tabPaths = getTabFolderPaths();
    if (tabPaths.size === 0) {
        const msg = document.createElement('div');
        msg.className = 'tree-empty-message';
        msg.textContent = 'No open tab folders';
        sidebarTree.appendChild(msg);
        return;
    }

    if (sidebarTabFilterFlat) {
        // Flat mode: each tab folder is a top-level node, no parent hierarchy
        const sorted = [...tabPaths.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const nodes = [];
        for (const [, originalPath] of sorted) {
            const name = originalPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean).pop() || originalPath;
            const node = createTreeNode(
                { name, path: originalPath, hasChildren: true },
                0
            );
            sidebarTree.appendChild(node);
            nodes.push(node);
        }
        // Auto-expand each tab folder to show its child directories (sequential to avoid IPC flood)
        for (const node of nodes) {
            await toggleTreeNode(node, 0);
        }
    } else {
        // Tree mode: show full parent hierarchy back to drive roots
        const allPaths = buildPathAncestry(tabPaths);
        const { roots, childrenMap } = buildFilteredTreeStructure(allPaths);

        for (const rootNorm of roots) {
            const originalPath = allPaths.get(rootNorm) || rootNorm;
            // Detect if this is a drive root (e.g. "C:/" or "/")
            const isDrive = /^[a-z]:\/$/i.test(originalPath.replace(/\\/g, '/')) || originalPath === '/' || originalPath === '\\';
            const name = isDrive
                ? originalPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
                : originalPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean).pop() || originalPath;

            const node = createTreeNode(
                { name, path: originalPath, hasChildren: childrenMap.has(rootNorm) },
                0,
                isDrive
            );
            sidebarTree.appendChild(node);
            renderFilteredChildren(node, rootNorm, 0, childrenMap, allPaths);
        }
    }

    // Highlight the active tab's folder
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.path) {
        sidebarHighlightActive(activeTab.path);
    }
}

/** Toggle the sidebar tab-filter mode. */
async function toggleSidebarTabFilter(force) {
    sidebarTabFilterActive = force !== undefined ? force : !sidebarTabFilterActive;
    localStorage.setItem('sidebarTabFilterActive', sidebarTabFilterActive.toString());

    if (sidebarTabFilterBtn) {
        sidebarTabFilterBtn.classList.toggle('active', sidebarTabFilterActive);
        sidebarTabFilterBtn.title = sidebarTabFilterActive
            ? 'Show all folders'
            : 'Show only tab folders';
    }

    // Show/hide the flat sub-toggle based on filter state
    if (sidebarTabFlatBtn) {
        sidebarTabFlatBtn.classList.toggle('hidden', !sidebarTabFilterActive);
    }

    if (sidebarTabFilterActive) {
        renderTabFilteredTree();
    } else {
        // Rebuild full tree
        sidebarExpandedNodes.clear();
        saveSidebarExpandedNodes();
        sidebarTree.innerHTML = '';
        await initSidebarDrives();
        // Re-expand to active tab's path
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab && activeTab.path) {
            sidebarExpandToPath(activeTab.path);
        }
    }
}

/** Toggle flat-list mode (sub-toggle of tab filter). */
function toggleSidebarTabFlat(force) {
    // Implicitly activate tab filter if not already active
    if (!sidebarTabFilterActive) {
        toggleSidebarTabFilter(true);
    }
    sidebarTabFilterFlat = force !== undefined ? force : !sidebarTabFilterFlat;
    localStorage.setItem('sidebarTabFilterFlat', sidebarTabFilterFlat.toString());

    if (sidebarTabFlatBtn) {
        sidebarTabFlatBtn.classList.toggle('active', sidebarTabFilterFlat);
        sidebarTabFlatBtn.title = sidebarTabFilterFlat
            ? 'Show parent folders'
            : 'Flat list (no parent folders)';
    }

    renderTabFilteredTree();
}

/** Reactive update: rebuild filtered tree when tabs change (debounced). */
let _tabsChangedRaf = null;
function onTabsChanged() {
    if (!sidebarTabFilterActive) return;
    if (_tabsChangedRaf) return;
    _tabsChangedRaf = requestAnimationFrame(() => {
        _tabsChangedRaf = null;
        if (sidebarTabFilterActive) renderTabFilteredTree();
    });
}

// ── Sidebar initialization ──

/** Load drive root nodes into the sidebar tree (extracted for reuse). */
async function initSidebarDrives() {
    try {
        const _drvRes = await window.electronAPI.getDrives();
        const drives = _drvRes && _drvRes.ok ? (_drvRes.value || []) : [];
        if (drives && drives.length > 0) {
            for (const drive of drives) {
                const node = createTreeNode(
                    { name: drive.name, path: drive.path, hasChildren: true },
                    0,
                    true
                );
                sidebarTree.appendChild(node);
                // Restore expanded state
                if (sidebarExpandedNodes.has(drive.path)) {
                    toggleTreeNode(node, 0, true);
                }
            }
        } else {
            // Non-Windows: show root
            const node = createTreeNode(
                { name: '/', path: '/', hasChildren: true },
                0,
                true
            );
            sidebarTree.appendChild(node);
            if (sidebarExpandedNodes.has('/')) {
                toggleTreeNode(node, 0, true);
            }
        }
    } catch (err) {
        console.error('Failed to load drives for sidebar:', err);
    }
}

async function initSidebar() {
    if (!folderSidebar || !sidebarTree) return;

    // Don't restore previous expanded state — start fresh, only the active folder will be expanded
    sidebarExpandedNodes.clear();
    saveSidebarExpandedNodes();

    // Restore width and collapsed state
    folderSidebar.style.width = sidebarWidth + 'px';
    if (sidebarCollapsed) {
        folderSidebar.classList.add('collapsed');
        if (sidebarToggleBtn) sidebarToggleBtn.classList.add('sidebar-is-collapsed');
    }

    // Toggle buttons
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
    }
    if (sidebarCollapseBtn) {
        sidebarCollapseBtn.addEventListener('click', () => setSidebarCollapsed(true));
    }

    // Tab-filter toggle button
    sidebarTabFilterBtn = document.getElementById('sidebar-tab-filter-btn');
    if (sidebarTabFilterBtn) {
        sidebarTabFilterBtn.addEventListener('click', () => toggleSidebarTabFilter());
        if (sidebarTabFilterActive) {
            sidebarTabFilterBtn.classList.add('active');
            sidebarTabFilterBtn.title = 'Show all folders';
        }
    }

    // Flat-list sub-toggle button (only visible when tab filter is active)
    sidebarTabFlatBtn = document.getElementById('sidebar-tab-flat-btn');
    if (sidebarTabFlatBtn) {
        sidebarTabFlatBtn.addEventListener('click', () => toggleSidebarTabFlat());
        if (sidebarTabFilterActive) {
            sidebarTabFlatBtn.classList.remove('hidden');
            if (sidebarTabFilterFlat) {
                sidebarTabFlatBtn.classList.add('active');
                sidebarTabFlatBtn.title = 'Show parent folders';
            }
        }
    }

    // Resize handle
    initSidebarResize();

    // Load tree — either filtered or full drives
    if (sidebarTabFilterActive) {
        renderTabFilteredTree();
    } else {
        await initSidebarDrives();
    }
}
