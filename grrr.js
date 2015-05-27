#!/usr/bin/gjs

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;
const Notify = imports.gi.Notify;
const Lang = imports.lang;

const APP_NAME = "Grrr!";

Notify.init(APP_NAME);

const res_name_default = "custom.gresource";
const res_prefix_default = "/org/gnome/custom";

let res_name = res_name_default;
let res_prefix = res_prefix_default;

let config = {};

let config_file = Gio.File.new_for_path(GLib.get_user_data_dir() + "/grrr/config.json");

if (config_file.query_exists(null)) {
    let size = config_file.query_info("standard::size",
                                  Gio.FileQueryInfoFlags.NONE,
                                  null).get_size();

    try {
        let data = config_file.read(null).read_bytes(size, null).get_data();

        config = JSON.parse(data);

        if (config.res_name) {
            res_name = config.res_name;
        }

        if (config.res_prefix) {
            res_prefix = config.res_prefix;
        }
    } catch (e) {
        printerr(e);
    }
}

function GResource() {
    this._name = res_name;
    this._prefix = res_prefix;

    this._files = [];
}

GResource.prototype.set_name = function(name) {
    this._name = name;
};

GResource.prototype.set_prefix = function(prefix) {
    this._prefix = prefix;
};

GResource.prototype.add = function(dir) {
    this._base = this._base || dir.get_parent();

    if (dir.query_info("standard::*",
                        Gio.FileQueryInfoFlags.NONE,
                        null).get_file_type() !== Gio.FileType.DIRECTORY) {

        this._files.push(dir);

        return;
    }

    let fileEnum;

    try {
        fileEnum = dir.enumerate_children("standard::name,standard::type",
                                           Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        fileEnum = null;
    }

    if (fileEnum !== null) {
        let info;

        while ((info = fileEnum.next_file(null)) !== null) {
            let file = dir.resolve_relative_path(info.get_name());

            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                this.add(file);
            } else {
                this._files.push(file);
            }
        }
    }
};

GResource.prototype.build = function() {
    let xml = "<?xml version='1.0' encoding='UTF-8'?>\n";

    xml += "<gresources>\n\t<gresource prefix='" + this._prefix + "'>\n";

    for (let file of this._files) {
        let info = file.query_info("standard::*", Gio.FileQueryInfoFlags.NONE, null);

        xml += "\t\t";

        let path = this._base.get_relative_path(file)
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;")
                        .replace(/'/g, "&apos;");

        if (/image\//.test(info.get_content_type())) {
            xml += "<file preprocess='to-pixdata'>" + path + "</file>\n";
        } else {
            xml += "<file>" + path + "</file>\n";
        }
    }

    xml += "\t</gresource>\n</gresources>\n";

    let xmlfile = this._base.resolve_relative_path(this._name + ".xml");

    if (xmlfile.query_exists(null)) {
        xmlfile.delete(null);
    }

    let outputstream = xmlfile.create(Gio.FileCreateFlags.REPLACE_DESTINATION, null);

    outputstream.write_all(xml, null);

    outputstream.close(null);
};

GResource.prototype.compile = function(cb = () => {}) {
    let ok, pid;

    try {
        [ ok, pid ] = GLib.spawn_async(this._base.get_path(),
                                        [ "glib-compile-resources", this._name + ".xml" ],
                                        GLib.get_environ(),
                                        GLib.SpawnFlags.SEARCH_PATH_FROM_ENVP | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                        null);
    } catch (e) {
        printerr(e);
    }

    if (ok === false) {
        return;
    }

    if (typeof pid === "number") {
        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => {
            GLib.spawn_close_pid(pid);

            try {
                let notification = new Notify.Notification({
                    summary: "Gresource file generated!",
                    body: this._name + " generated at " + this._base.get_path(),
                    icon_name: "dialog-information"
                });

                notification.set_timeout(1000);

                notification.show();
            } catch (e) {
                printerr(e);
            }

            cb();
        });
    }
};

const Application = new Lang.Class({
    Name: APP_NAME,

    _init: function() {
        this.application = new Gtk.Application({
            application_id: "org.ozonos.grrr",
            flags: Gio.ApplicationFlags.FLAGS_NONE
        });

        this.application.connect("activate", Lang.bind(this, this._onActivate));
        this.application.connect("startup", Lang.bind(this, this._onStartup));
    },

    _buildUI: function() {
        this._window = new Gtk.ApplicationWindow({
                            application: this.application,
                            window_position: Gtk.WindowPosition.CENTER,
                            title: APP_NAME
                        });

        try {
            let icon = Gtk.IconTheme.get_default().load_icon("binary", 48, 0);

            this._window.set_icon(icon);
        } catch (e) {
            printerr(e);
        }

        this._headerbar = new Gtk.HeaderBar({
            title: APP_NAME,
            show_close_button: true
        });

        // Add options to set the name and the prefix
        let grid = new Gtk.Grid({
            column_spacing: 10,
            row_spacing: 10,
            margin: 10
        });

        grid.set_column_homogeneous(true);

        let namelabel = new Gtk.Label({ label: "File name:" });

        namelabel.set_halign(Gtk.Align.END);

        let nameentry = new Gtk.Entry();

        nameentry.connect("changed", () => res_name = nameentry.get_text());

        nameentry.set_placeholder_text(res_name_default);

        grid.attach(namelabel, 0, 0, 1, 1);
        grid.attach_next_to(nameentry, namelabel, Gtk.PositionType.RIGHT, 2, 1);

        let prefixlabel = new Gtk.Label({ label: "Resource prefix:" });

        prefixlabel.set_halign(Gtk.Align.END);

        let prefixentry = new Gtk.Entry();

        prefixentry.set_placeholder_text(res_prefix_default);

        prefixentry.connect("changed", () => res_prefix = prefixentry.get_text());

        grid.attach(prefixlabel, 0, 1, 1, 1);
        grid.attach_next_to(prefixentry, prefixlabel, Gtk.PositionType.RIGHT, 2, 1);

        let button = new Gtk.ToggleButton();

        button.add(new Gtk.Image ({
            icon_name: "open-menu-symbolic",
            icon_size: Gtk.IconSize.SMALL_TOOLBAR
        }));

        button.connect("clicked", () => {
            if (button.get_active()) {
                menu.show_all();
            }
        });

        let menu = new Gtk.Popover();

        menu.set_relative_to(button);

        menu.connect("show", () => {
            nameentry.set_text(res_name);
            prefixentry.set_text(res_prefix);
        });

        menu.connect("closed", () => {
            if (button.get_active()) {
                button.set_active(false);
            }

            res_name = res_name || res_name_default;
            res_prefix = res_prefix || res_prefix_default;

            let write = false;

            if (config.res_name !== res_name) {
                config.res_name = res_name;

                write = true;
            }

            if (config.res_prefix !== res_prefix) {
                config.res_prefix = res_prefix;

                write = true;
            }

            if (write) {
                let parent = config_file.get_parent();

                if (parent.query_exists(null)) {
                    if (config_file.query_exists(null)) {
                        config_file.delete(null);
                    }
                } else {
                    parent.make_directory_with_parents(null);
                }

                let outputstream = config_file.create(Gio.FileCreateFlags.REPLACE_DESTINATION, null);

                outputstream.write_all(JSON.stringify(config), null);

                outputstream.close(null);
            }
        });

        menu.add(grid);

        this._headerbar.pack_end(button);

        let spinner = new Gtk.Spinner({ active: true });

        spinner.set_size_request(64, 64);

        let label = new Gtk.Label({ label: "Drop files and folders to generate a gresource file!" });

        // Let's set up our window for drag 'n drop
        let dnd = new Gtk.Box();

        dnd.set_vexpand(true);
        dnd.set_hexpand(true);

        dnd.drag_dest_set(Gtk.DestDefaults.ALL, null, Gdk.DragAction.COPY);

        dnd.drag_dest_add_text_targets();

        dnd.connect("drag_data_received", (s, c, x, y, selection) => {

            dnd.set_center_widget(spinner);

            dnd.show_all();

            let gresource = new GResource();

            let text = selection.get_text();

            if (text) {
                let uris = text.split("\n").map(u => u.trim()).filter(u => !!u);

                for (let uri of uris) {
                    gresource.add(Gio.File.new_for_uri(uri));
                }
            }

            gresource.build();
            gresource.compile(() => {
                let complete = new Gtk.Label({ label: res_name + " generated!" });

                dnd.set_center_widget(complete);

                dnd.show_all();

                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    dnd.set_center_widget(label);

                    dnd.show_all();

                    return false;
                }, null);
            });
        });

        dnd.set_center_widget(label);

        // Add some styles
        let css = new Gtk.CssProvider();

        css.load_from_data("* { font-size: large; }");

        dnd.get_style_context().add_provider(css, 0);

        this._window.add(dnd);

        this._window.set_default_size(800, 600);
        this._window.set_titlebar(this._headerbar);
        this._window.show_all();
    },

    _onActivate: function() {
        this._window.present();
    },

    _onStartup: function() {
        this._buildUI();
    }
});

let app = new Application();

app.application.run(ARGV);
