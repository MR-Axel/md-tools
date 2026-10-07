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
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-set]') : null;
    if (!b) return;
    set(b.getAttribute('data-set'));
    try { localStorage.setItem('mdtools:site-lang', b.getAttribute('data-set')); } catch (err) { /* sin almacenamiento */ }
  });
})();
