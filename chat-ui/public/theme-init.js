// Applies the saved or system theme before first paint so there is no flash of the wrong one.
// Kept as a separate file (not inline in index.html) so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var pref = localStorage.getItem('chat.theme');
    var dark = pref === 'dark' || ((pref === null || pref === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
