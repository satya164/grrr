#!/usr/bin/gjs

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;
const Notify = imports.gi.Notify;
const Lang = imports.lang;

const APP_NAME = "Grrr!";

Notify.init(APP_NAME);

function GResource() {
    this._name = "custom.gresource";
    this._prefix = "/org/gnome/custom";

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

        if (/image\//.test(info.get_content_type())) {
            xml += "<file preprocess='to-pixdata'>" + this._base.get_relative_path(file) + "</file>\n";
        } else {
            xml += "<file>" + this._base.get_relative_path(file) + "</file>\n";
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

GResource.prototype.compile = function() {
    let ok, pid;

    try {
        [ ok, pid ] = GLib.spawn_async(this._base.get_path(),
                                        [ "glib-compile-resources", this._name + ".xml" ],
                                        GLib.get_environ(),
                                        GLib.SpawnFlags.SEARCH_PATH_FROM_ENVP | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                        null);
    } catch (e) {
        print("Failed to run process: " + e.message);
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
                print("Failed to show notification: " + e.message);
            }
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
            print("Failed to load application icon: " + e.message);
        }

        this._headerbar = new Gtk.HeaderBar({
            title: APP_NAME,
            show_close_button: true
        });

        // Let's set up our window for drag 'n drop
        let dnd = new Gtk.Box();

        dnd.set_vexpand(true);
        dnd.set_hexpand(true);

        dnd.drag_dest_set(Gtk.DestDefaults.ALL, null, Gdk.DragAction.COPY);

        dnd.drag_dest_add_text_targets();

        dnd.connect("drag_data_received", (s, c, x, y, selection) => {
            let gresource = new GResource();

            let text = selection.get_text();

            if (text) {
                let uris = text.split("\n").map(u => u.trim()).filter(u => !!u);

                for (let uri of uris) {
                    gresource.add(Gio.File.new_for_uri(uri));
                }
            }

            gresource.build();
            gresource.compile();
        });

        let label = new Gtk.Label({ label: "Drop files and folders to generate a gresource file!" });

        dnd.set_center_widget(label);

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
