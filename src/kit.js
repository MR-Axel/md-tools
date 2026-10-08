// Piezas sueltas que usa todo el lector: íconos, creación de nodos y utilidades.
(function () {
  'use strict';

  const ICON = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
    outline: '<svg viewBox="0 0 24 24"><path d="M5 7h14M8 12h11M11 17h8"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
    side: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/></svg>',
    md: '<svg viewBox="0 0 24 24"><path d="M4 17V7l4 5 4-5v10M16 7v9m-3-3 3 3 3-3"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    keyboard: '<svg viewBox="0 0 24 24"><rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M7 14h.01M17 14h.01M10 14h4"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17h-11z"/><path d="M9.5 8h5M9.5 12h5M9.5 16h3"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13"/></svg>',
    reload: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7.5 8.5v-5h9v5"/><rect x="3.5" y="8.5" width="17" height="8" rx="1.5"/><path d="M7.5 14h9v6.5h-9z"/></svg>',
    rich: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/><path d="m11.6 17 2.4-6 2.4 6M12.4 15.2h3.2"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14 8 3 3"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M5 4.5h11l3.5 3.5v11.5h-14.5z"/><path d="M8 4.5v5h7v-5M8 19.5v-6h8v6"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5.5M14 11v5.5"/></svg>',
    b_p: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
    b_h1: '<svg viewBox="0 0 24 24"><path d="M4 6v12M11 6v12M4 12h7M16 10l2.5-2v10"/></svg>',
    b_h2: '<svg viewBox="0 0 24 24"><path d="M4 6v12M11 6v12M4 12h7M15.5 10a2.3 2.3 0 0 1 4.5.7c0 2-4.5 4.3-4.5 7.300H20"/></svg>',
    b_h3: '<svg viewBox="0 0 24 24"><path d="M4 6v12M11 6v12M4 12h7M15.5 9.500a2.2 2.2 0 1 1 2.2 3.3 2.4 2.4 0 1 1-2.4 3.4"/></svg>',
    b_ul: '<svg viewBox="0 0 24 24"><path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17" r="1"/></svg>',
    b_ol: '<svg viewBox="0 0 24 24"><path d="M10 7h10M10 12h10M10 17h10M4 5.5 5.5 5v4M4 14.500c0-1.5 2.5-1.5 2.5 0 0 1-2.5 1.8-2.5 3.500h2.5"/></svg>',
    b_task: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="6" height="6" rx="1.5"/><rect x="3.5" y="13.5" width="6" height="6" rx="1.5"/><path d="m5 7.5 1.2 1.200L8.3 6.300M13 7.500h8M13 16.500h8"/></svg>',
    b_quote: '<svg viewBox="0 0 24 24"><path d="M5 5v14M9.5 8h10M9.5 12h10M9.5 16h6"/></svg>',
    b_table: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M3.5 14.500h17M9.5 5v14M15 5v14"/></svg>',
    b_code: '<svg viewBox="0 0 24 24"><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4"/></svg>',
    b_diagram: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="7" height="5" rx="1.2"/><rect x="13.5" y="15" width="7" height="5" rx="1.2"/><path d="M7 9v4.500a2 2 0 0 0 2 2h4.5"/></svg>',
    b_math: '<svg viewBox="0 0 24 24"><path d="M17.5 5H7l5.5 7L7 19h10.5"/></svg>',
    b_board: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="5" height="15" rx="1.2"/><rect x="10" y="4.5" width="5" height="10" rx="1.2"/><rect x="16.5" y="4.5" width="4" height="7" rx="1.2"/></svg>',
    b_alert: '<svg viewBox="0 0 24 24"><path d="M12 4.5 3.5 19h17z"/><path d="M12 10v4M12 16.500v.200"/></svg>',
    b_details: '<svg viewBox="0 0 24 24"><path d="m4.500 5.500 3 3-3 3M11.500 8.500H20M7.500 14.500H20M7.500 18.500h8"/></svg>',
    b_image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4.5 17.5 5-4.5 3.5 3 2.5-2 4 3.5"/></svg>',
    b_link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    b_hr: '<svg viewBox="0 0 24 24"><path d="M4 12h16M8 7h8M8 17h8" opacity=".999"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.300A3.85 3.85 0 0 1 17.5 18.500z"/></svg>',
    cloudOk: '<svg viewBox="0 0 24 24"><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.300A3.85 3.85 0 0 1 17.5 18.500z"/><path d="m9.5 13.5 2 2 3.5-3.5"/></svg>',
    cloudAlert: '<svg viewBox="0 0 24 24"><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.300A3.85 3.85 0 0 1 17.5 18.500z"/><path d="M12 10.500v3.500M12 16v.200"/></svg>',
    cloudOff: '<svg viewBox="0 0 24 24"><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.300A3.85 3.85 0 0 1 17.5 18.500z"/><path d="M4 4l16 16"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4.5h11.5l-2 4 2 4H5"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.500M12 14.200v2.100"/></svg>',
    unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.500V8a4 4 0 0 1 7.700-1.500M12 14.200v2.100"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="m12 4 2 5.500 5.500 2.500-5.500 2.500-2 5.500-2-5.500L4.500 12l5.500-2.500z"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17M7 14.500h3.500"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.500v2.700M12 17.800v2.700M3.500 12h2.700M17.800 12h2.700M6 6l1.900 1.900M16.100 16.100 18 18M6 18l1.900-1.900M16.100 7.900 18 6"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.500" width="17" height="13" rx="2"/><path d="m4.500 7.500 7.500 5.500 7.500-5.500"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M3 18.5V6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h7.4A1.5 1.5 0 0 1 20 8.7V10"/><path d="M3 18.5 5.6 11a1.5 1.5 0 0 1 1.4-1h13.2a1 1 0 0 1 .9 1.4L18.6 18a1.5 1.5 0 0 1-1.4 1H3.6"/></svg>',
    comment: '<svg viewBox="0 0 24 24"><path d="M5 5h14a1.5 1.5 0 0 1 1.500 1.500v8.500a1.5 1.5 0 0 1-1.500 1.500h-7.500L7.500 20v-3.500H5a1.5 1.5 0 0 1-1.500-1.500V6.500A1.5 1.5 0 0 1 5 5z"/></svg>',
    disk: '<svg viewBox="0 0 24 24"><path d="M4.5 14.5 7 6.2A1.7 1.7 0 0 1 8.600 5h6.800A1.7 1.7 0 0 1 17 6.2l2.500 8.300"/><rect x="3.500" y="14.500" width="17" height="5" rx="1.500"/><path d="M7 17h.200M10 17h4"/></svg>',
    browser: '<svg viewBox="0 0 24 24"><rect x="3.500" y="5" width="17" height="14" rx="2"/><path d="M3.500 9.500h17M6.500 7.300h.200M9 7.300h.200"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7.500V12l3 2"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><path d="M3.500 19a5.500 5.500 0 0 1 11 0"/><circle cx="16.800" cy="9.800" r="2.500"/><path d="M16.500 14.700a4.500 4.500 0 0 1 4 4.300"/></svg>',
    key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15.5" r="4"/><path d="m11 12.5 8.5-8.5M15.5 8l2.5 2.5M18 5.5 20 7.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.3 7 9 4.1-1.7 7-4.7 7-9V6z"/><path d="m9 12 2.2 2.2 3.8-4"/></svg>',
    coffee: '<svg viewBox="0 0 24 24"><path d="M5 9h11v5.5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14.5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M11.5 3.5v2.5"/></svg>',
  };

  const el = (tag, attrs, html) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const MD_RE = /\.(md|mdx|mkd|mdown|markdown)$/i;
  const SKIP_DIRS = /^(node_modules|\.git|dist|build|__pycache__)$/i;

  // Un correo bien formado: sin espacios, una sola arroba, el nombre sin puntos al borde ni dobles, y un
  // dominio de etiquetas válidas que termina en letras. Es la misma regla que aplica el servidor.
  const validEmail = (v) => {
    const e = String(v || ''); const m = /^([^\s@]+)@([^\s@]+)$/.exec(e);
    if (!m || e.length > 200 || /^\.|\.$|\.\./.test(m[1]) || /[(),:;<>[\]\\"]/.test(m[1])) return false;
    const labels = m[2].split('.');
    return labels.length > 1 && labels.every((l) => /^[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(l)) && /^(\p{L}{2,}|xn--[a-z0-9-]+)$/iu.test(labels[labels.length - 1]);
  };

  // Entrega un archivo. En iPhone y iPad sale por la hoja de compartir, donde está Guardar en Archivos: ahí una
  // descarga común abre el archivo en vez de guardarlo. En el resto, y si la hoja no acepta el archivo, se descarga.
  // Hay que llamarla dentro del gesto (el clic): Safari no abre la hoja de compartir fuera de él.
  function saveFile(blob, name) {
    const link = () => { const a = el('a', { download: name }); a.href = URL.createObjectURL(blob); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    try {
      if (LMD.device && LMD.device.ios && navigator.share && navigator.canShare) {
        // Safari no reconoce todos los tipos: un .md viaja como texto.
        const types = [blob.type || 'application/octet-stream'].concat(/^text\//.test(blob.type) ? ['text/plain'] : []);
        for (const type of types) {
          const file = new File([blob], name, { type });
          if (!navigator.canShare({ files: [file] })) continue;
          navigator.share({ files: [file] }).catch((e) => { if (!e || e.name !== 'AbortError') link(); }); // cerrar la hoja no es un error
          return 'share';
        }
      }
    } catch (e) { /* sin hoja de compartir: se descarga */ }
    link();
    return 'download';
  }
  LMD.kit = { ICON, el, esc, debounce, MD_RE, SKIP_DIRS, validEmail, saveFile };
})();
