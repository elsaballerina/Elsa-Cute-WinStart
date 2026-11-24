import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const APP_CATEGORIES = [
    { id: 'all', label: 'All Apps', match: [] },
{ id: 'accessories', label: 'Accessories', match: ['Utility', 'Core'] },
{ id: 'internet', label: 'Internet', match: ['Network', 'WebBrowser', 'Email'] },
{ id: 'office', label: 'Office', match: ['Office'] },
{ id: 'graphics', label: 'Graphics', match: ['Graphics'] },
{ id: 'games', label: 'Games', match: ['Game'] },
{ id: 'media', label: 'Sound & Video', match: ['AudioVideo', 'Audio', 'Video'] },
{ id: 'system', label: 'System', match: ['System', 'Settings', 'Development'] },
];

function getConnectorForMonitorIndex(index) {
    try {
        const monitor = Main.layoutManager.monitors[index];
        if (monitor && monitor.connector) {
            return monitor.connector;
        }
    } catch (_e) {
        // Fallback
    }
    return `Monitor-${index + 1}`;
}

function runCommand(cmd) {
    try {
        GLib.spawn_command_line_async(cmd);
    } catch (e) {
        logError(e, `Elsa-Cute-WinStart failed to run: ${cmd}`);
    }
}

export default class ElsaCuteWinStartExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._panels = [];
        this._signals = [];
        this._clockTimerId = null;
        this._defaultOverlayKeyId = 0;
        this._customOverlayKeyId = 0;
        this._overlayKeyBlocked = false;
        this._windowTracker = Shell.WindowTracker.get_default();
        this._appSystem = Shell.AppSystem.get_default();

        this._applyTopPanelVisibility();
        this._rebuildPanels();
        this._applySuperKeyOverride();
        this._startClock();

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (key === 'detected-monitors') return;
            if (key === 'hide-top-panel') {
                this._applyTopPanelVisibility();
                return;
            }
            if (key === 'override-super-key') {
                this._applySuperKeyOverride();
                return;
            }
            this._rebuildPanels();
        });

        this._connectSignal(Main.layoutManager, 'monitors-changed', () => this._rebuildPanels());
        this._connectSignal(global.display, 'window-created', (_d, win) => {
            this._watchWindow(win);
            this._refreshAllTasks();
        });
        this._connectSignal(global.display, 'notify::focus-window', () => this._refreshAllTasks());
        this._connectSignal(global.display, 'window-entered-monitor', () => this._refreshAllTasks());
        this._connectSignal(global.display, 'window-left-monitor', () => this._refreshAllTasks());
        this._connectSignal(global.workspace_manager, 'active-workspace-changed', () => this._refreshAllTasks());

        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (win) this._watchWindow(win);
        }
    }

    disable() {
        this._removeSuperKeyOverride();

        if (this._clockTimerId) {
            GLib.Source.remove(this._clockTimerId);
            this._clockTimerId = null;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        for (const { obj, id } of this._signals) {
            try {
                obj.disconnect(id);
            } catch (_e) {
                // Already destroyed
            }
        }
        this._signals = [];

        this._destroyPanels();

        if (Main.panel) {
            Main.panel.show();
        }

        this._settings = null;
    }

    _applySuperKeyOverride() {
        this._removeSuperKeyOverride();
        if (!this._settings.get_boolean('override-super-key')) return;

        this._defaultOverlayKeyId = GObject.signal_handler_find(global.display, {
            signalId: 'overlay-key',
        });
        if (this._defaultOverlayKeyId) {
            GObject.signal_handler_block(global.display, this._defaultOverlayKeyId);
            this._overlayKeyBlocked = true;
        }

        this._customOverlayKeyId = global.display.connect('overlay-key', () => {
            this._toggleActiveStartMenu();
        });
    }

    _removeSuperKeyOverride() {
        if (this._customOverlayKeyId) {
            global.display.disconnect(this._customOverlayKeyId);
            this._customOverlayKeyId = 0;
        }
        if (this._overlayKeyBlocked && this._defaultOverlayKeyId) {
            GObject.signal_handler_unblock(global.display, this._defaultOverlayKeyId);
            this._overlayKeyBlocked = false;
        }
    }

    _toggleActiveStartMenu() {
        const currentMon = global.display.get_current_monitor();
        let target = this._panels.find(p => p.monitorIndex === currentMon && p.startMenu);
        if (!target) {
            target = this._panels.find(p => p.startMenu);
        }
        if (!target) return;

        for (const p of this._panels) {
            if (p !== target && p.startMenu) p.startMenu.close();
            if (p.rightMenu) p.rightMenu.close();
        }
        target.startMenu.toggle();
    }

    _connectSignal(obj, signal, callback) {
        const id = obj.connect(signal, callback);
        this._signals.push({ obj, id });
    }

    _watchWindow(win) {
        if (win._ecwsWatched) return;
        win._ecwsWatched = true;
        win.connect('notify::title', () => this._refreshAllTasks());
        win.connect('notify::minimized', () => this._refreshAllTasks());
        win.connect('unmanaged', () => this._refreshAllTasks());
    }

    _applyTopPanelVisibility() {
        if (!Main.panel) return;
        if (this._settings.get_boolean('hide-top-panel')) {
            Main.panel.hide();
        } else {
            Main.panel.show();
        }
    }

    _getMonitorConfigs() {
        try {
            return JSON.parse(this._settings.get_string('monitor-config') || '{}');
        } catch (_e) {
            return {};
        }
    }

    _publishDetectedMonitors() {
        const list = Main.layoutManager.monitors.map((m, idx) => ({
            index: idx,
            connector: getConnectorForMonitorIndex(idx),
                                                                  width: m.width,
                                                                  height: m.height,
                                                                  primary: idx === Main.layoutManager.primaryIndex,
        }));
        const serialized = JSON.stringify(list);
        if (this._settings.get_string('detected-monitors') !== serialized) {
            this._settings.set_string('detected-monitors', serialized);
        }
        return list;
    }

    _destroyPanels() {
        for (const panelObj of this._panels) {
            for (const menu of panelObj.menus) {
                menu.destroy();
            }
            for (const menu of panelObj.staticMenus) {
                menu.destroy();
            }
            Main.layoutManager.removeChrome(panelObj.container);
            panelObj.container.destroy();
        }
        this._panels = [];
    }

    _buildStartMenu(startBtn, position, theme) {
        const side = position === 'top' ? St.Side.TOP : St.Side.BOTTOM;
        const menu = new PopupMenu.PopupMenu(startBtn, 0.0, side);
        menu.actor.add_style_class_name(`theme-${theme}`);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();

        const rootItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        menu.addMenuItem(rootItem);

        const mainBox = new St.BoxLayout({
            style_class: 'ecws-start-menu-box',
            orientation: Clutter.Orientation.VERTICAL,
        });
        rootItem.add_child(mainBox);

        // 1. Live Search Entry
        const searchEntry = new St.Entry({
            style_class: 'ecws-search-entry',
            hint_text: 'Search apps...',
            can_focus: true,
            x_expand: true,
        });
        mainBox.add_child(searchEntry);

        // 2. Two Columns: Categories + Scrollable Apps
        const columnsBox = new St.BoxLayout({
            style_class: 'ecws-menu-columns',
            y_expand: true,
        });
        mainBox.add_child(columnsBox);

        const catCol = new St.BoxLayout({
            style_class: 'ecws-categories-col',
            orientation: Clutter.Orientation.VERTICAL,
        });
        columnsBox.add_child(catCol);

        const appsScroll = new St.ScrollView({
            style_class: 'ecws-apps-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        const appsList = new St.BoxLayout({
            style_class: 'ecws-apps-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        appsScroll.add_child(appsList);
        columnsBox.add_child(appsScroll);

        let selectedCategory = 'all';
        const catButtons = new Map();

        const populateApps = () => {
            appsList.destroy_all_children();
            const query = searchEntry.get_text().trim().toLowerCase();
            const catObj = APP_CATEGORIES.find(c => c.id === selectedCategory);
            const allApps = this._appSystem.get_installed()
            .filter(info => info.should_show())
            .sort((a, b) => (a.get_display_name() || '').localeCompare(b.get_display_name() || ''));

            for (const appInfo of allApps) {
                const name = appInfo.get_display_name() || appInfo.get_name() || '';
                const desc = appInfo.get_description() || '';

                if (query.length > 0) {
                    if (!name.toLowerCase().includes(query) && !desc.toLowerCase().includes(query)) {
                        continue;
                    }
                } else if (catObj && catObj.match.length > 0) {
                    const cats = (appInfo.get_categories() || '').split(';');
                    if (!catObj.match.some(m => cats.includes(m))) {
                        continue;
                    }
                }

                const btn = new St.Button({
                    style_class: 'ecws-app-item',
                    reactive: true,
                    track_hover: true,
                    x_expand: true,
                    x_align: Clutter.ActorAlign.FILL,
                });
                const row = new St.BoxLayout({
                    style: 'spacing: 8px;',
                    x_expand: true,
                    x_align: Clutter.ActorAlign.START,
                });
                const icon = appInfo.get_icon();
                if (icon) {
                    row.add_child(new St.Icon({ gicon: icon, icon_size: 22 }));
                }
                const lbl = new St.Label({
                    text: name,
                    x_align: Clutter.ActorAlign.START,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                row.add_child(lbl);
                btn.set_child(row);

                btn.connect('clicked', () => {
                    menu.close();
                    const shellApp = this._appSystem.lookup_app(appInfo.get_id());
                    if (shellApp) shellApp.activate();
                    else appInfo.launch([], null);
                });

                    appsList.add_child(btn);
            }
        };

        for (const cat of APP_CATEGORIES) {
            const cBtn = new St.Button({
                style_class: `ecws-cat-button${cat.id === 'all' ? ' active' : ''}`,
                reactive: true,
                track_hover: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            cBtn.set_child(new St.Label({
                text: cat.label,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            cBtn.connect('clicked', () => {
                selectedCategory = cat.id;
                for (const [id, b] of catButtons.entries()) {
                    if (id === cat.id) b.add_style_class_name('active');
                    else b.remove_style_class_name('active');
                }
                populateApps();
            });
            catButtons.set(cat.id, cBtn);
            catCol.add_child(cBtn);
        }

        searchEntry.clutter_text.connect('text-changed', () => populateApps());
        searchEntry.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                menu.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        menu.connect('open-state-changed', (_m, isOpen) => {
            if (isOpen) {
                searchEntry.set_text('');
                populateApps();
                global.stage.set_key_focus(searchEntry.clutter_text);
            }
        });

        return menu;
    }

    _buildRightClickStartMenu(startBtn, position) {
        const side = position === 'top' ? St.Side.TOP : St.Side.BOTTOM;
        const menu = new PopupMenu.PopupMenu(startBtn, 0.0, side);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();

        const addEntry = (label, callback) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                menu.close();
                callback();
            });
            menu.addMenuItem(item);
        };

        addEntry('Elsa-Cute-WinStart Settings', () => this.openPreferences());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        addEntry('Terminal', () => runCommand('sh -c "ptyxis || gnome-terminal || kgx"'));
        addEntry('Files', () => runCommand('nautilus'));
        addEntry('System Settings', () => runCommand('gnome-control-center'));
        addEntry('System Monitor', () => runCommand('gnome-system-monitor'));
        addEntry('Disks', () => runCommand('gnome-disks'));
        addEntry('Software', () => runCommand('gnome-software'));

        return menu;
    }

    _rebuildPanels() {
        this._destroyPanels();

        const detected = this._publishDetectedMonitors();
        const configs = this._getMonitorConfigs();
        const theme = this._settings.get_string('theme');
        const style = this._settings.get_string('panel-style');
        const height = this._settings.get_int('panel-height');
        const fontSize = this._settings.get_int('font-size');
        const iconSize = this._settings.get_int('icon-size');
        const showStart = this._settings.get_boolean('show-start-button');
        const startLabel = this._settings.get_string('start-button-label');
        const showTray = this._settings.get_boolean('show-system-tray');
        const showClock = this._settings.get_boolean('show-clock');

        for (const monInfo of detected) {
            const cfg = Object.assign(
                { enabled: true, position: 'bottom', taskSource: 'this', customSources: [] },
                configs[monInfo.connector] || {}
            );

            if (!cfg.enabled) continue;

            const monitor = Main.layoutManager.monitors[monInfo.index];
            const yPos = cfg.position === 'top'
            ? monitor.y
            : monitor.y + monitor.height - height;

            const container = new St.BoxLayout({
                style_class: `ecws-panel theme-${theme} style-${style}`,
                x: monitor.x,
                y: yPos,
                width: monitor.width,
                height: height,
                reactive: true,
                style: `font-size: ${fontSize}pt;`,
            });

            const staticMenus = [];
            const menuManager = new PopupMenu.PopupMenuManager(container);
            let startMenu = null;
            let rightMenu = null;

            // Start Button (Left-Click: Custom Start Menu | Right-Click: Win+X Linux Menu)
            if (showStart) {
                const startBtn = new St.Button({
                    style_class: 'ecws-start-button',
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                const startBox = new St.BoxLayout({ style: 'spacing: 6px;' });
                startBox.add_child(new St.Icon({
                    icon_name: 'start-here-symbolic',
                    icon_size: iconSize,
                }));
                if (startLabel.trim().length > 0) {
                    startBox.add_child(new St.Label({
                        text: startLabel,
                        y_align: Clutter.ActorAlign.CENTER,
                    }));
                }
                startBtn.set_child(startBox);

                startMenu = this._buildStartMenu(startBtn, cfg.position, theme);
                rightMenu = this._buildRightClickStartMenu(startBtn, cfg.position);
                staticMenus.push(startMenu, rightMenu);
                menuManager.addMenu(startMenu);
                menuManager.addMenu(rightMenu);

                startBtn.connect('button-press-event', (_actor, event) => {
                    const button = event.get_button();
                    if (button === 3) {
                        startMenu.close();
                        rightMenu.toggle();
                        return Clutter.EVENT_STOP;
                    }
                    if (button === 1) {
                        rightMenu.close();
                        startMenu.toggle();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                container.add_child(startBtn);
            }

            // Taskbar Box
            const tasksBox = new St.BoxLayout({
                style_class: 'ecws-tasks-box',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            container.add_child(tasksBox);

            // System Tray (Sound, Network, Bluetooth, Battery -> opens GNOME Quick Settings)
            if (showTray) {
                const trayBtn = new St.Button({
                    style_class: 'ecws-button ecws-tray',
                    reactive: true,
                    track_hover: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                const trayBox = new St.BoxLayout({ style: 'spacing: 8px;' });
                const trayIconSize = Math.max(14, iconSize - 3);
                trayBox.add_child(new St.Icon({ icon_name: 'network-wireless-symbolic', icon_size: trayIconSize }));
                trayBox.add_child(new St.Icon({ icon_name: 'bluetooth-active-symbolic', icon_size: trayIconSize }));
                trayBox.add_child(new St.Icon({ icon_name: 'audio-volume-high-symbolic', icon_size: trayIconSize }));
                trayBox.add_child(new St.Icon({ icon_name: 'battery-good-symbolic', icon_size: trayIconSize }));
                trayBtn.set_child(trayBox);

                trayBtn.connect('clicked', () => {
                    if (Main.panel?.statusArea?.quickSettings) {
                        Main.panel.statusArea.quickSettings.menu.toggle();
                    }
                });
                container.add_child(trayBtn);
            }

            // Clock
            let clockLabel = null;
            if (showClock) {
                const clockBtn = new St.Button({
                    style_class: 'ecws-clock',
                    reactive: true,
                    track_hover: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                clockLabel = new St.Label({
                    text: this._formatTime(),
                                          y_align: Clutter.ActorAlign.CENTER,
                });
                clockBtn.set_child(clockLabel);
                clockBtn.connect('clicked', () => {
                    if (Main.panel?.statusArea?.dateMenu) {
                        Main.panel.statusArea.dateMenu.menu.toggle();
                    }
                });
                container.add_child(clockBtn);
            }

            Main.layoutManager.addChrome(container, {
                affectsStruts: true,
                trackFullscreen: true,
            });

            this._panels.push({
                monitorIndex: monInfo.index,
                connector: monInfo.connector,
                config: cfg,
                container,
                tasksBox,
                clockLabel,
                startMenu,
                rightMenu,
                menus: [],
                staticMenus,
                menuManager,
            });
        }

        this._refreshAllTasks();
    }

    _getFilteredWindowsForPanel(panelObj) {
        const allWindows = global.get_window_actors()
        .map(a => a.meta_window)
        .filter(w => w && !w.is_skip_taskbar() && w.get_window_type() === Meta.WindowType.NORMAL);

        const source = panelObj.config.taskSource || 'this';
        if (source === 'all') return allWindows;

        if (source === 'custom') {
            const allowed = new Set(panelObj.config.customSources || []);
            return allWindows.filter(w => allowed.has(getConnectorForMonitorIndex(w.get_monitor())));
        }

        return allWindows.filter(w => w.get_monitor() === panelObj.monitorIndex);
    }

    _activateOrMinimizeWindow(win) {
        const focusWin = global.display.focus_window;
        if (focusWin === win && !win.minimized) {
            win.minimize();
        } else {
            if (win.minimized) win.unminimize();
            win.activate(global.get_current_time());
        }
    }

    _refreshAllTasks() {
        const mode = this._settings.get_string('task-mode');
        const iconSize = this._settings.get_int('icon-size');
        const focusWin = global.display.focus_window;

        for (const panelObj of this._panels) {
            for (const menu of panelObj.menus) {
                menu.destroy();
            }
            panelObj.menus = [];
            panelObj.tasksBox.destroy_all_children();

            const windows = this._getFilteredWindowsForPanel(panelObj);

            if (mode === 'grouped') {
                const groups = new Map();
                for (const win of windows) {
                    const app = this._windowTracker.get_window_app(win);
                    const key = app ? app.get_id() : (win.get_wm_class() || 'unknown');
                    if (!groups.has(key)) groups.set(key, { app, windows: [] });
                    groups.get(key).windows.push(win);
                }

                for (const { app, windows: groupWins } of groups.values()) {
                    const isActive = groupWins.some(w => w === focusWin);
                    const btn = new St.Button({
                        style_class: `ecws-button ecws-task-button${isActive ? ' active' : ''}`,
                        reactive: true,
                        track_hover: true,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const box = new St.BoxLayout({ style: 'spacing: 6px;' });
                    if (app) box.add_child(app.create_icon_texture(iconSize));
                    const label = new St.Label({
                        text: app ? app.get_name() : (groupWins[0].get_title() || 'Window'),
                                               y_align: Clutter.ActorAlign.CENTER,
                    });
                    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    box.add_child(label);

                    if (groupWins.length > 1) {
                        box.add_child(new St.Label({
                            text: `${groupWins.length}`,
                            style_class: 'ecws-badge',
                            y_align: Clutter.ActorAlign.CENTER,
                        }));
                    }

                    btn.set_child(box);

                    if (groupWins.length === 1) {
                        btn.connect('clicked', () => this._activateOrMinimizeWindow(groupWins[0]));
                    } else {
                        const side = panelObj.config.position === 'top' ? St.Side.TOP : St.Side.BOTTOM;
                        const menu = new PopupMenu.PopupMenu(btn, 0.5, side);
                        Main.uiGroup.add_child(menu.actor);
                        menu.actor.hide();
                        for (const w of groupWins) {
                            const item = new PopupMenu.PopupMenuItem(w.get_title() || 'Untitled');
                            item.connect('activate', () => this._activateOrMinimizeWindow(w));
                            menu.addMenuItem(item);
                        }
                        panelObj.menus.push(menu);
                        panelObj.menuManager.addMenu(menu);
                        btn.connect('clicked', () => menu.toggle());
                    }

                    panelObj.tasksBox.add_child(btn);
                }
            } else {
                for (const win of windows) {
                    const app = this._windowTracker.get_window_app(win);
                    const isActive = win === focusWin && !win.minimized;
                    const classes = ['ecws-button', 'ecws-task-button'];
                    if (mode === 'compact') classes.push('compact');
                    if (isActive) classes.push('active');
                    if (win.minimized) classes.push('minimized');

                    const btn = new St.Button({
                        style_class: classes.join(' '),
                                              reactive: true,
                                              track_hover: true,
                                              y_align: Clutter.ActorAlign.CENTER,
                    });

                    const box = new St.BoxLayout({ style: 'spacing: 6px;' });
                    if (app) box.add_child(app.create_icon_texture(iconSize));

                    if (mode === 'separate') {
                        const label = new St.Label({
                            text: win.get_title() || (app ? app.get_name() : 'Window'),
                                                   y_align: Clutter.ActorAlign.CENTER,
                        });
                        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                        box.add_child(label);
                    }

                    btn.set_child(box);
                    btn.connect('clicked', () => this._activateOrMinimizeWindow(win));
                    panelObj.tasksBox.add_child(btn);
                }
            }
        }
    }

    _formatTime() {
        return GLib.DateTime.new_now_local().format('%H:%M');
    }

    _startClock() {
        this._clockTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            const now = this._formatTime();
            for (const panelObj of this._panels) {
                if (panelObj.clockLabel) panelObj.clockLabel.set_text(now);
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}
