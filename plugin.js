// Alf Notion Super Productivity, v0.2 — safe shell.
// All Notion network reads and configuration happen only in the explicit
// iframe preview. There are no task hooks, background jobs or write paths.
// MIT license: see LICENSE (original copyright Alessio Lovato).
'use strict';

PluginAPI.registerHeaderButton({
  label: 'Alf Notion',
  icon: 'view_list',
  onClick: () => PluginAPI.showIndexHtmlAsView()
});
