/**
 * Aplica la paleta del hotel mediante variables CSS (index, login).
 */
(function aplicarModulo(global) {
    const DEF = {
        color_primario: '#ff6b35',
        color_secundario: '#ff8c42',
        color_acento: '#ffb347',
        color_titulo: '#8b4513'
    };

    function hexNormalizado(val) {
        if (val == null || val === '') return null;
        let s = String(val).trim();
        if (/^#[0-9A-Fa-f]{8}$/.test(s)) {
            s = '#' + s.slice(1, 7);
        }
        if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
            return (
                '#' +
                s[1].toLowerCase().repeat(2) +
                s[2].toLowerCase().repeat(2) +
                s[3].toLowerCase().repeat(2)
            );
        }
        if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
        return null;
    }

    function rgbTripletDesdeHex(hexValido6) {
        const n = hexValido6.slice(1);
        const r = parseInt(n.slice(0, 2), 16);
        const g = parseInt(n.slice(2, 4), 16);
        const b = parseInt(n.slice(4, 6), 16);
        return `${r}, ${g}, ${b}`;
    }

    function aplicar(doc, paleta) {
        const p = paleta || {};
        const prim = hexNormalizado(p.color_primario) || DEF.color_primario;
        const sec = hexNormalizado(p.color_secundario) || DEF.color_secundario;
        const ac = hexNormalizado(p.color_acento) || DEF.color_acento;
        const tit = hexNormalizado(p.color_titulo) || DEF.color_titulo;
        const root = doc.documentElement;
        root.style.setProperty('--color-primary', prim);
        root.style.setProperty('--color-primary-mid', sec);
        root.style.setProperty('--color-primary-light', ac);
        root.style.setProperty('--color-heading', tit);
        root.style.setProperty('--color-primary-rgb', rgbTripletDesdeHex(prim));
    }

    function urlFondoValida(val) {
        if (val == null) return null;
        const s = String(val).trim();
        if (!s) return null;
        if (s.startsWith('/')) return s;
        if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
        return null;
    }

    /**
     * Aplica imagen de fondo al body. Si no hay valor válido, vuelve al CSS por defecto.
     */
    function aplicarFondo(doc, paleta) {
        if (!doc || !doc.body) return;
        const fondo = urlFondoValida(paleta && paleta.fondo_imagen_url);
        if (fondo) {
            doc.body.style.backgroundImage = `url("${fondo}")`;
            doc.body.style.backgroundSize = 'cover';
            doc.body.style.backgroundPosition = 'center';
            doc.body.style.backgroundAttachment = 'fixed';
            doc.body.style.backgroundRepeat = 'no-repeat';
            return;
        }
        doc.body.style.removeProperty('background-image');
        doc.body.style.removeProperty('background-size');
        doc.body.style.removeProperty('background-position');
        doc.body.style.removeProperty('background-attachment');
        doc.body.style.removeProperty('background-repeat');
    }

    function nombreVisible(paleta) {
        const n = paleta && paleta.nombre != null ? String(paleta.nombre).trim() : '';
        return n || 'Mi Hotel';
    }

    const TITULO_PESTANA = '{nombre}';
    const STORAGE_NOMBRE_HOTEL = 'hotelNombreMarca';

    function guardarNombreEnStorage(nombre) {
        try {
            const n = String(nombre || '').trim();
            if (n) {
                localStorage.setItem(STORAGE_NOMBRE_HOTEL, n);
            }
        } catch (_) { /* ignore */ }
    }

    function leerNombreDesdeStorage() {
        try {
            const n = localStorage.getItem(STORAGE_NOMBRE_HOTEL);
            return n && String(n).trim() ? String(n).trim() : null;
        } catch (_) {
            return null;
        }
    }

    /** Mismo nombre en login (#loginHotelNombre), cabecera (#hotelNombre) y título de pestaña. */
    function aplicarNombre(doc, paleta, opciones) {
        const opts = opciones || {};
        const nombre = nombreVisible(paleta);
        const loginTitulo = doc.getElementById('loginHotelNombre');
        if (loginTitulo) {
            loginTitulo.textContent = nombre;
        }
        const cabecera = doc.getElementById('hotelNombre');
        if (cabecera) {
            cabecera.textContent = nombre;
        }
        doc.querySelectorAll('[data-nombre-hotel]').forEach((el) => {
            el.textContent = nombre;
        });
        const plantilla = opts.tituloDocumento != null ? opts.tituloDocumento : TITULO_PESTANA;
        doc.title = plantilla.replace('{nombre}', nombre);
        guardarNombreEnStorage(nombre);
        return nombre;
    }

    /** Aplica de inmediato el último nombre guardado (p. ej. al abrir login). */
    function aplicarNombreDesdeStorage(doc) {
        const nombre = leerNombreDesdeStorage();
        if (!nombre) {
            return null;
        }
        return aplicarNombre(doc, { nombre });
    }

    /** Colores + nombre unificado (login e index). */
    function aplicarMarcaHotel(doc, datos) {
        aplicar(doc, datos);
        aplicarFondo(doc, datos);
        return aplicarNombre(doc, datos);
    }

    global.TemaHotel = {
        DEF,
        TITULO_PESTANA,
        STORAGE_NOMBRE_HOTEL,
        aplicar,
        aplicarNombre,
        aplicarNombreDesdeStorage,
        aplicarMarcaHotel,
        aplicarFondo,
        urlFondoValida,
        guardarNombreEnStorage,
        leerNombreDesdeStorage,
        nombreVisible,
        hexNormalizado
    };
})(typeof window !== 'undefined' ? window : globalThis);
