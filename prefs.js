import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { THEMES, STYLES, TASK_MODES } from './themes.js';

function addCuteHeader(page) {
    const group = new Adw.PreferencesGroup();
    const label = new Gtk.Label({
        use_markup: true,
        label: '<span size="x-large" weight="bold">🌸 Elsa-Cute-WinStart ✨ 1.0 v1.0</span>',
        halign: Gtk.Align.CENTER,
        margin_top: 4,
        margin_bottom: 4,
    });
    group.add(label);
    page.add(group);
}

function addCuteFooter(page) {
    const group = new Adw.PreferencesGroup();
    const label = new Gtk.Label({
        use_markup: true,
        label: '🌸 Made with 💖 by <a href="https://elsaballerina.github.io">Elsa Ballerina</a> 🌸',
        halign: Gtk.Align.CENTER,
        margin_top: 8,
        margin_bottom: 4,
    });
    group.add(label);
    page.add(group);
}

export default class ElsaCuteWinStartPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_title('🌸 Elsa-Cute-WinStart ✨ 1.0 v1.0');
        window.set_default_size(640, 620);

        // =====================================================
        // PAGE 1: APPEARANCE
        // =====================================================
        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(appearancePage);
        addCuteHeader(appearancePage);

        const themeGroup = new Adw.PreferencesGroup({
            title: 'Theme & Style',
            description: 'Calm, eye-friendly palettes paired with classic or cute shapes.',
        });
        appearancePage.add(themeGroup);

        const themeKeys = Object.keys(THEMES);
        const themeModel = new Gtk.StringList();
        themeKeys.forEach(k => themeModel.append(THEMES[k].label));

        const themeRow = new Adw.ComboRow({
            title: 'Color Theme',
            model: themeModel,
            selected: Math.max(0, themeKeys.indexOf(settings.get_string('theme'))),
        });
        themeRow.connect('notify::selected', () => {
            settings.set_string('theme', themeKeys[themeRow.selected]);
        });
        themeGroup.add(themeRow);

        const styleKeys = Object.keys(STYLES);
        const styleModel = new Gtk.StringList();
        styleKeys.forEach(k => styleModel.append(STYLES[k]));

        const styleRow = new Adw.ComboRow({
            title: 'Panel Style',
            model: styleModel,
            selected: Math.max(0, styleKeys.indexOf(settings.get_string('panel-style'))),
        });
        styleRow.connect('notify::selected', () => {
            settings.set_string('panel-style', styleKeys[styleRow.selected]);
        });
        themeGroup.add(styleRow);

        const sizeGroup = new Adw.PreferencesGroup({ title: 'Sizing & GNOME Bar' });
        appearancePage.add(sizeGroup);

        const addSpinRow = (title, key, min, max, step = 1) => {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({
                    lower: min,
                    upper: max,
                    step_increment: step,
                    value: settings.get_int(key),
                }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            sizeGroup.add(row);
        };

        addSpinRow('Taskbar Height (px)', 'panel-height', 28, 64, 2);
        addSpinRow('Icon Size (px)', 'icon-size', 14, 36, 2);
        addSpinRow('Font Size (pt)', 'font-size', 9, 18, 1);

        const hideTopRow = new Adw.SwitchRow({
            title: 'Hide Default GNOME Top Bar',
            subtitle: 'Turn off anytime to bring the standard top bar back',
        });
        settings.bind('hide-top-panel', hideTopRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sizeGroup.add(hideTopRow);

        addCuteFooter(appearancePage);

        // =====================================================
        // PAGE 2: TASKS & START
        // =====================================================
        const tasksPage = new Adw.PreferencesPage({
            title: 'Tasks & Start',
            icon_name: 'view-list-symbolic',
        });
        window.add(tasksPage);
        addCuteHeader(tasksPage);

        const taskGroup = new Adw.PreferencesGroup({ title: 'Taskbar Behavior' });
        tasksPage.add(taskGroup);

        const modeKeys = Object.keys(TASK_MODES);
        const modeModel = new Gtk.StringList();
        modeKeys.forEach(k => modeModel.append(TASK_MODES[k]));

        const modeRow = new Adw.ComboRow({
            title: 'Task Grouping Mode',
            model: modeModel,
            selected: Math.max(0, modeKeys.indexOf(settings.get_string('task-mode'))),
        });
        modeRow.connect('notify::selected', () => {
            settings.set_string('task-mode', modeKeys[modeRow.selected]);
        });
        taskGroup.add(modeRow);

        const startGroup = new Adw.PreferencesGroup({ title: 'Start Button, Tray & Clock' });
        tasksPage.add(startGroup);

        const bindSwitch = (group, title, key) => {
            const row = new Adw.SwitchRow({ title });
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };

        bindSwitch(startGroup, 'Show Start Button', 'show-start-button');
        bindSwitch(startGroup, 'Open Start Menu with Super (Win) Key', 'override-super-key');

        const startLabelRow = new Adw.EntryRow({
            title: 'Start Button Text',
            text: settings.get_string('start-button-label'),
        });
        startLabelRow.connect('changed', () => {
            settings.set_string('start-button-label', startLabelRow.text);
        });
        startGroup.add(startLabelRow);

        bindSwitch(startGroup, 'Show System Tray (Sound, Network, Bluetooth, Power)', 'show-system-tray');
        bindSwitch(startGroup, 'Show Clock', 'show-clock');

        addCuteFooter(tasksPage);

        // =====================================================
        // PAGE 3: MONITORS (PER-SCREEN CONTROL)
        // =====================================================
        const monitorsPage = new Adw.PreferencesPage({
            title: 'Monitors',
            icon_name: 'video-display-symbolic',
        });
        window.add(monitorsPage);
        addCuteHeader(monitorsPage);

        let detected = [];
        try {
            detected = JSON.parse(settings.get_string('detected-monitors') || '[]');
        } catch (_e) {
            detected = [];
        }

        let configs = {};
        try {
            configs = JSON.parse(settings.get_string('monitor-config') || '{}');
        } catch (_e) {
            configs = {};
        }

        const saveConfigs = () => {
            settings.set_string('monitor-config', JSON.stringify(configs));
        };

        if (detected.length === 0) {
            const emptyGroup = new Adw.PreferencesGroup({
                title: 'No Monitors Detected Yet',
                description: 'Enable the extension first so it can detect your connected displays.',
            });
            monitorsPage.add(emptyGroup);
            addCuteFooter(monitorsPage);
            return;
        }

        const sourceKeys = ['this', 'all', 'custom'];
        const sourceLabels = ['This Screen Only', 'All Screens', 'Custom Screen Selection'];

        for (const mon of detected) {
            if (!configs[mon.connector]) {
                configs[mon.connector] = {
                    enabled: true,
                    position: 'bottom',
                    taskSource: 'this',
                    customSources: [mon.connector],
                };
            }
            const monCfg = configs[mon.connector];

            const group = new Adw.PreferencesGroup({
                title: `${mon.connector}${mon.primary ? ' (Primary)' : ''}`,
                                                   description: `Resolution: ${mon.width} × ${mon.height}`,
            });
            monitorsPage.add(group);

            const enableRow = new Adw.SwitchRow({
                title: 'Show Taskbar on This Screen',
                active: monCfg.enabled,
            });
            enableRow.connect('notify::active', () => {
                monCfg.enabled = enableRow.active;
                saveConfigs();
            });
            group.add(enableRow);

            const posModel = new Gtk.StringList();
            posModel.append('Bottom');
            posModel.append('Top');
            const posRow = new Adw.ComboRow({
                title: 'Position',
                model: posModel,
                selected: monCfg.position === 'top' ? 1 : 0,
            });
            posRow.connect('notify::selected', () => {
                monCfg.position = posRow.selected === 1 ? 'top' : 'bottom';
                saveConfigs();
            });
            group.add(posRow);

            const srcModel = new Gtk.StringList();
            sourceLabels.forEach(l => srcModel.append(l));
            const srcRow = new Adw.ComboRow({
                title: 'Show Tasks From',
                model: srcModel,
                selected: Math.max(0, sourceKeys.indexOf(monCfg.taskSource || 'this')),
            });
            group.add(srcRow);

            const customExpander = new Adw.ExpanderRow({
                title: 'Custom Source Screens',
                subtitle: 'Choose which screens feed tasks into this taskbar',
                visible: monCfg.taskSource === 'custom',
            });

            for (const other of detected) {
                const checkRow = new Adw.SwitchRow({
                    title: other.connector,
                    active: (monCfg.customSources || []).includes(other.connector),
                });
                checkRow.connect('notify::active', () => {
                    const set = new Set(monCfg.customSources || []);
                    if (checkRow.active) set.add(other.connector);
                    else set.delete(other.connector);
                    monCfg.customSources = Array.from(set);
                    saveConfigs();
                });
                customExpander.add_row(checkRow);
            }
            group.add(customExpander);

            srcRow.connect('notify::selected', () => {
                monCfg.taskSource = sourceKeys[srcRow.selected];
                customExpander.visible = monCfg.taskSource === 'custom';
                saveConfigs();
            });
        }

        addCuteFooter(monitorsPage);
    }
}
