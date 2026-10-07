// Idioma de la página de presentación: inglés, o el que se eligió la última vez con el botón.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('mdtools:site-lang'); } catch (e) { /* sin almacenamiento */ }
  var lang = saved === 'es' ? 'es' : 'en';
  function set(l) {
    document.documentElement.setAttribute('data-lang', l);
    document.documentElement.lang = l;
    var title = document.querySelector('title[data-' + l + ']');
    if (title) document.title = title.getAttribute('data-' + l);
  }
  set(lang);
  // Un enlace a una sección (privacy.html#delete-account) lleva a esa sección en el idioma que se ve. La del otro
  // idioma está oculta y el navegador no tendría adónde ir: su gemela lleva data-same con el id de la primera.
  function toSection() {
    var id = location.hash.slice(1).replace(/[^\w-]/g, '');
    var t = id ? document.getElementById(id) : null;
    if (t && !t.offsetParent) t = document.querySelector('[data-same="' + id + '"]');
    if (t && t.scrollIntoView) t.scrollIntoView();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', toSection); else toSection();
  window.addEventListener('hashchange', toSection);
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-set]') : null;
    if (!b) return;
    set(b.getAttribute('data-set'));
    try { localStorage.setItem('mdtools:site-lang', b.getAttribute('data-set')); } catch (err) { /* sin almacenamiento */ }
  });
})();
