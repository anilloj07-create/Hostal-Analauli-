const API_URL = `${window.location.origin}/api`;

// Variables globales
let habitacionActualId = null;
let habitaciones = [];
let chinchorros = [];
let huespedes = [];
let reservas = [];
let reservasChinchorros = [];
let usuarioActual = null;
let listaUsuariosAdmin = [];
/** Últimos datos de hotel (nombre y colores de tema) tras GET /api/hotel */
let datosHotelCache = null;
const filtrosBusqueda = {
    habitaciones: '',
    huespedes: '',
    reservas: '',
    chinchorros: ''
};

const _ahoraCal = new Date();
let calendarioMesVista = {
    y: _ahoraCal.getFullYear(),
    m: _ahoraCal.getMonth()
};

/** Fecha local YYYY-MM-DD (evita desfase UTC de toISOString). */
function fechaLocalYMD(d = new Date()) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function formatoMoneda(num) {
    if (num == null || !Number.isFinite(Number(num))) {
        return '—';
    }
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(Number(num));
}

function textoBusquedaNormalizado(v) {
    return String(v == null ? '' : v)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function coincideBusqueda(valor, termino) {
    if (!termino) return true;
    return textoBusquedaNormalizado(valor).includes(termino);
}

function actualizarFiltroModulo(modulo, valor) {
    const k = String(modulo || '').trim().toLowerCase();
    if (!(k in filtrosBusqueda)) return;
    filtrosBusqueda[k] = textoBusquedaNormalizado(valor || '');
    if (k === 'habitaciones') {
        mostrarHabitaciones();
        return;
    }
    if (k === 'huespedes') {
        mostrarHuespedes();
        return;
    }
    if (k === 'reservas') {
        renderModuloReservas();
        return;
    }
    if (k === 'chinchorros') {
        mostrarChinchorros();
    }
}

function etiquetaHabitacion(hab) {
    if (!hab) return 'Habitación';
    const nombre = hab.nombre != null ? String(hab.nombre).trim() : '';
    if (nombre) return nombre;
    if (hab.numero != null && String(hab.numero).trim()) return String(hab.numero).trim();
    if (hab.codigo != null && String(hab.codigo).trim()) return String(hab.codigo).trim();
    return `Habitación ${hab.id}`;
}

function etiquetaHabitacionReserva(r) {
    if (!r) return 'Habitación';
    const nombre = r.habitacion_nombre != null ? String(r.habitacion_nombre).trim() : '';
    if (nombre) return nombre;
    if (r.habitacion_numero != null && String(r.habitacion_numero).trim()) {
        return String(r.habitacion_numero).trim();
    }
    return r.habitacion_id != null ? `Habitación #${r.habitacion_id}` : 'Habitación';
}

function etiquetaChinchorro(c) {
    if (!c) return 'Chinchorro';
    const nombre = c.nombre != null ? String(c.nombre).trim() : '';
    if (nombre) return nombre;
    if (c.numero != null && String(c.numero).trim()) return String(c.numero).trim();
    if (c.codigo != null && String(c.codigo).trim()) return String(c.codigo).trim();
    return `Chinchorro ${c.id}`;
}

function etiquetaChinchorroReserva(r) {
    if (!r) return 'Chinchorro';
    const nombre = r.chinchorro_nombre != null ? String(r.chinchorro_nombre).trim() : '';
    if (nombre) return nombre;
    if (r.chinchorro_codigo != null && String(r.chinchorro_codigo).trim()) {
        return String(r.chinchorro_codigo).trim();
    }
    return r.chinchorro_id != null ? `Chinchorro #${r.chinchorro_id}` : 'Chinchorro';
}

function habitacionesFiltradas() {
    const t = filtrosBusqueda.habitaciones;
    if (!t) return habitaciones;
    return habitaciones.filter((h) =>
        coincideBusqueda(etiquetaHabitacion(h), t) ||
        coincideBusqueda(h.tipo, t) ||
        coincideBusqueda(h.piso, t) ||
        coincideBusqueda(h.estado, t)
    );
}

function huespedesFiltrados() {
    const t = filtrosBusqueda.huespedes;
    if (!t) return huespedes;
    return huespedes.filter((h) => huespedCoincideTextoBusqueda(h, t));
}

function etiquetaHuesped(h) {
    if (!h) return '';
    const nom = `${h.nombre || ''} ${h.apellido || ''}`.trim();
    const doc = h.documento != null ? String(h.documento).trim() : '';
    const tipo = h.tipo_documento != null ? String(h.tipo_documento).trim() : '';
    if (doc) {
        const pref = tipo ? `${tipo}: ` : 'Doc: ';
        return nom ? `${nom} · ${pref}${doc}` : `${pref}${doc}`;
    }
    return nom || `Huésped #${h.id}`;
}

/** Coincide si el término ya viene normalizado (sin tildes, minúsculas). */
function huespedCoincideTextoBusqueda(h, terminoNormalizado) {
    if (!terminoNormalizado) return false;
    const partes = terminoNormalizado.split(/\s+/).filter(Boolean);
    if (partes.length === 0) return false;
    const blob = textoBusquedaNormalizado(
        `${h.nombre || ''} ${h.apellido || ''} ${h.documento || ''} ${h.tipo_documento || ''} ${h.email || ''} ${h.telefono || ''}`
    );
    return partes.every((p) => blob.includes(p));
}

const MIN_CHARS_BUSQUEDA_HUESPED = 2;

function mostrarMensajeComboboxHuesped(inst, mensaje) {
    const lista = inst.listaEl;
    if (!lista) return;
    lista.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'combobox-sin-resultados';
    li.textContent = mensaje;
    lista.appendChild(li);
    lista.hidden = false;
    if (inst.textoEl) {
        inst.textoEl.setAttribute('aria-expanded', 'true');
    }
}

const comboboxHuespedInstancias = new Map();

function obtenerComboboxHuesped(hiddenId) {
    return comboboxHuespedInstancias.get(hiddenId);
}

function renderListaComboboxHuesped(inst, filtro) {
    const lista = inst.listaEl;
    if (!lista) return;

    if (!Array.isArray(huespedes) || huespedes.length === 0) {
        mostrarMensajeComboboxHuesped(
            inst,
            'No hay huéspedes registrados. Créelos en la pestaña Huéspedes.'
        );
        return;
    }

    const t = textoBusquedaNormalizado(filtro);
    if (!t || t.length < MIN_CHARS_BUSQUEDA_HUESPED) {
        mostrarMensajeComboboxHuesped(
            inst,
            `Escriba al menos ${MIN_CHARS_BUSQUEDA_HUESPED} letras (nombre, apellido o documento).`
        );
        return;
    }

    const coincidencias = huespedes.filter((h) => huespedCoincideTextoBusqueda(h, t));
    const max = 40;
    const mostrar = coincidencias.slice(0, max);
    lista.innerHTML = '';
    if (mostrar.length === 0) {
        mostrarMensajeComboboxHuesped(inst, 'Sin coincidencias. Pruebe con otro nombre o documento.');
        return;
    }
    mostrar.forEach((h) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.id = String(h.id);
        li.textContent = etiquetaHuesped(h);
        li.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            seleccionarComboboxHuesped(inst, h.id, etiquetaHuesped(h));
        });
        lista.appendChild(li);
    });
    if (coincidencias.length > max) {
        const li = document.createElement('li');
        li.className = 'combobox-sin-resultados';
        li.textContent = `… y ${coincidencias.length - max} más. Refine la búsqueda.`;
        lista.appendChild(li);
    }
    lista.hidden = false;
    if (inst.textoEl) {
        inst.textoEl.setAttribute('aria-expanded', 'true');
    }
}

function ocultarListaComboboxHuesped(inst) {
    if (!inst || !inst.listaEl) return;
    inst.listaEl.hidden = true;
    if (inst.textoEl) {
        inst.textoEl.setAttribute('aria-expanded', 'false');
    }
}

function seleccionarComboboxHuesped(inst, id, etiqueta) {
    if (!inst) return;
    if (inst.hiddenEl) {
        inst.hiddenEl.value = id != null ? String(id) : '';
    }
    if (inst.textoEl) {
        inst.textoEl.value = etiqueta || '';
    }
    ocultarListaComboboxHuesped(inst);
}

function limpiarComboboxHuesped(hiddenId) {
    const inst = obtenerComboboxHuesped(hiddenId);
    if (!inst) return;
    if (inst.hiddenEl) inst.hiddenEl.value = '';
    if (inst.textoEl) inst.textoEl.value = '';
    ocultarListaComboboxHuesped(inst);
}

function establecerComboboxHuesped(hiddenId, huespedId, textoMostrar) {
    const inst = obtenerComboboxHuesped(hiddenId);
    if (!inst) return;
    const h = huespedes.find((x) => Number(x.id) === Number(huespedId));
    const etiqueta = textoMostrar && String(textoMostrar).trim() ? textoMostrar.trim() : h ? etiquetaHuesped(h) : '';
    seleccionarComboboxHuesped(inst, huespedId, etiqueta);
}

function initComboboxHuesped(config) {
    const textoEl = document.getElementById(config.textoId);
    const hiddenEl = document.getElementById(config.hiddenId);
    const listaEl = document.getElementById(config.listaId);
    if (!textoEl || !hiddenEl || !listaEl) return;

    const inst = { textoId: config.textoId, hiddenId: config.hiddenId, listaId: config.listaId, textoEl, hiddenEl, listaEl };
    comboboxHuespedInstancias.set(config.hiddenId, inst);

    textoEl.addEventListener('input', () => {
        hiddenEl.value = '';
        renderListaComboboxHuesped(inst, textoEl.value);
    });
    textoEl.addEventListener('focus', () => {
        renderListaComboboxHuesped(inst, textoEl.value);
    });
    textoEl.addEventListener('blur', () => {
        window.setTimeout(() => {
            if (!inst.listaEl.matches(':hover') && document.activeElement !== textoEl) {
                ocultarListaComboboxHuesped(inst);
                const id = hiddenEl.value.trim();
                if (!id && textoEl.value.trim()) {
                    const t = textoBusquedaNormalizado(textoEl.value);
                    const exactos = huespedes.filter(
                        (h) => textoBusquedaNormalizado(etiquetaHuesped(h)) === t
                    );
                    if (exactos.length === 1) {
                        seleccionarComboboxHuesped(inst, exactos[0].id, etiquetaHuesped(exactos[0]));
                    } else if (t.length >= MIN_CHARS_BUSQUEDA_HUESPED) {
                        const parciales = huespedes.filter((h) => huespedCoincideTextoBusqueda(h, t));
                        if (parciales.length === 1) {
                            seleccionarComboboxHuesped(inst, parciales[0].id, etiquetaHuesped(parciales[0]));
                        }
                    }
                }
            }
        }, 180);
    });
    textoEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            ocultarListaComboboxHuesped(inst);
        }
    });
}

async function asegurarHuespedesParaReserva() {
    if (huespedes.length > 0) return;
    try {
        const response = await fetchWithAuth(`${API_URL}/huespedes`);
        if (response.ok) {
            huespedes = await response.json();
        }
    } catch (e) {
        console.error('Error al cargar huéspedes para reserva:', e);
    }
}

function initComboboxesHuespedReserva() {
    initComboboxHuesped({
        textoId: 'textoHuespedReserva',
        hiddenId: 'huespedReserva',
        listaId: 'listaHuespedReserva'
    });
    initComboboxHuesped({
        textoId: 'textoHuespedReservaChin',
        hiddenId: 'huespedReservaChin',
        listaId: 'listaHuespedReservaChin'
    });
    if (!window.__comboboxHuespedClickCerrar) {
        window.__comboboxHuespedClickCerrar = true;
        document.addEventListener('click', (ev) => {
            comboboxHuespedInstancias.forEach((inst) => {
                const wrap = inst.textoEl && inst.textoEl.closest('.combobox-huesped-wrap');
                if (wrap && !wrap.contains(ev.target)) {
                    ocultarListaComboboxHuesped(inst);
                }
            });
        });
    }
}

function reservasHabitacionesFiltradas() {
    const t = filtrosBusqueda.reservas;
    if (!t) return reservas;
    return reservas.filter((r) =>
        coincideBusqueda(r.id, t) ||
        coincideBusqueda(r.habitacion_numero, t) ||
        coincideBusqueda(r.huesped_nombre, t) ||
        coincideBusqueda(r.huesped_apellido, t) ||
        coincideBusqueda(r.tipo_habitacion_requerida, t) ||
        coincideBusqueda(r.metodo_pago, t) ||
        coincideBusqueda(r.estado, t)
    );
}

function reservasChinchorrosFiltradas() {
    const t = filtrosBusqueda.reservas;
    if (!t) return reservasChinchorros;
    return reservasChinchorros.filter((r) =>
        coincideBusqueda(r.id, t) ||
        coincideBusqueda(etiquetaChinchorroReserva(r), t) ||
        coincideBusqueda(r.huesped_nombre, t) ||
        coincideBusqueda(r.huesped_apellido, t) ||
        coincideBusqueda(r.tipo_requerido, t) ||
        coincideBusqueda(r.metodo_pago, t) ||
        coincideBusqueda(r.estado, t)
    );
}

function reservasUnificadasFiltradas() {
    const items = [];
    reservasHabitacionesFiltradas().forEach((r) => {
        items.push({ tipo: 'habitacion', reserva: r, id: Number(r.id) });
    });
    reservasChinchorrosFiltradas().forEach((r) => {
        items.push({ tipo: 'chinchorro', reserva: r, id: Number(r.id) });
    });
    items.sort((a, b) => b.id - a.id);
    return items;
}

function renderModuloReservas() {
    renderAcomodacionDelDia();
    renderTablaReservasUnificada();
}

function renderTablaReservasUnificada() {
    const tbody = document.getElementById('tablaReservasUnificada');
    if (!tbody) return;

    const lista = reservasUnificadasFiltradas();
    if (!lista.length) {
        const vacio =
            reservas.length === 0 && reservasChinchorros.length === 0
                ? 'No hay reservas registradas.'
                : 'Sin resultados para la búsqueda actual.';
        tbody.innerHTML = `<tr><td colspan="14" class="gestion-vacio-celda">${vacio}</td></tr>`;
        return;
    }

    tbody.innerHTML = lista
        .map((item) => {
            const r = item.reserva;
            if (item.tipo === 'habitacion') {
                const fechaIngreso = new Date(r.fecha_ingreso).toLocaleDateString('es-ES');
                const fechaSalida = new Date(r.fecha_salida).toLocaleDateString('es-ES');
                const estadoClass = claseEstadoReservaHabitacion(r.estado);
                const acciones = htmlAccionesReservaHabitacion(r)
                    .replace(/^\s*<td[^>]*>\s*/, '')
                    .replace(/\s*<\/td>\s*$/, '');
                return `
                <tr>
                    <td>${r.id}</td>
                    <td>Habitación</td>
                    <td><strong>${escapeHtmlCal(etiquetaHabitacionReserva(r))}</strong></td>
                    <td>${escapeHtmlCal(`${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim())}</td>
                    <td>${Number(r.adultos || 1)} / ${Number(r.ninos || 0)}</td>
                    <td>${fechaIngreso}</td>
                    <td>${fechaSalida}</td>
                    <td><span class="estado-badge ${estadoClass}">${escapeHtmlCal(r.estado)}</span></td>
                    <td>${escapeHtmlCal(formatoMoneda(Number(r.habitacion_precio_diario) || 0))} <span class="muted">/noche</span></td>
                    <td>${textoValorReservaHabitacion(r)}</td>
                    <td>${htmlCeldaPagoReserva(r, valorMonetarioReservaHabitacion, saldoReservaHabitacion)}</td>
                    <td>${htmlCeldaSaldoReserva(r, saldoReservaHabitacion)}</td>
                    <td class="gestion-obs-celda">${escapeHtmlCal(r.observaciones || '—')}</td>
                    <td class="td-acciones-reserva">${acciones}</td>
                </tr>`;
            }
            const fechaIngreso = new Date(r.fecha_ingreso).toLocaleDateString('es-ES');
            const fechaSalida = new Date(r.fecha_salida).toLocaleDateString('es-ES');
            const estadoClass = claseEstadoReservaChinchorro(r.estado);
            const acciones = htmlAccionesReservaChinchorro(r)
                .replace(/^\s*<td[^>]*>\s*/, '')
                .replace(/\s*<\/td>\s*$/, '');
            return `
                <tr>
                    <td>${r.id}</td>
                    <td>Chinchorro</td>
                    <td><strong>${escapeHtmlCal(etiquetaChinchorroReserva(r))}</strong></td>
                    <td>${escapeHtmlCal(`${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim())}</td>
                    <td>${Number(r.adultos || 1)} / ${Number(r.ninos || 0)}</td>
                    <td>${fechaIngreso}</td>
                    <td>${fechaSalida}</td>
                    <td><span class="estado-badge ${estadoClass}">${escapeHtmlCal(r.estado)}</span></td>
                    <td>${escapeHtmlCal(formatoMoneda(Number(r.chinchorro_precio_diario) || 0))} <span class="muted">/día</span></td>
                    <td>${textoValorReservaChinchorro(r)}</td>
                    <td>${htmlCeldaPagoReserva(r, valorMonetarioReservaChinchorro, saldoReservaChinchorro)}</td>
                    <td>${htmlCeldaSaldoReserva(r, saldoReservaChinchorro)}</td>
                    <td class="gestion-obs-celda">${escapeHtmlCal(r.observaciones || '—')}</td>
                    <td class="td-acciones-reserva">${acciones}</td>
                </tr>`;
        })
        .join('');
}

function chinchorrosFiltrados() {
    const t = filtrosBusqueda.chinchorros;
    if (!t) return chinchorros;
    return chinchorros.filter((c) =>
        coincideBusqueda(etiquetaChinchorro(c), t) ||
        coincideBusqueda(c.tipo, t) ||
        coincideBusqueda(c.piso, t) ||
        coincideBusqueda(c.zona, t) ||
        coincideBusqueda(c.estado, t)
    );
}

function totalEstimadoNuevaReserva(tarifa, fechaIngreso, fechaSalida) {
    const p = Number(tarifa);
    if (!Number.isFinite(p) || p <= 0) return 0;
    return p * unidadesEstadiaYMD(fechaIngreso, fechaSalida);
}

function unidadesEstadiaYMD(fechaIngreso, fechaSalida) {
    const fi = String(fechaIngreso).slice(0, 10);
    const fs = String(fechaSalida).slice(0, 10);
    const a = new Date(`${fi}T12:00:00`);
    const b = new Date(`${fs}T12:00:00`);
    const days = Math.round((b - a) / (24 * 3600 * 1000));
    return Math.max(1, days);
}

function textoValorReservaHabitacion(r) {
    const p = Number(r.habitacion_precio_diario);
    const u = unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
    if (!Number.isFinite(p) || p <= 0) {
        return '<span class="muted">Sin tarifa</span>';
    }
    return `<span class="txt-precio-small">${formatoMoneda(p)} /noche<br><strong>${formatoMoneda(p * u)}</strong> <span class="muted">(${u} noches)</span></span>`;
}

function textoValorReservaChinchorro(r) {
    const p = Number(r.chinchorro_precio_diario);
    const u = unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
    if (!Number.isFinite(p) || p <= 0) {
        return '<span class="muted">Sin tarifa</span>';
    }
    return `<span class="txt-precio-small">${formatoMoneda(p)} /día<br><strong>${formatoMoneda(p * u)}</strong> <span class="muted">(${u} días)</span></span>`;
}

function valorMonetarioReservaHabitacion(r) {
    const p = Number(r.habitacion_precio_diario);
    if (!Number.isFinite(p) || p <= 0) return 0;
    return p * unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
}

function valorMonetarioReservaChinchorro(r) {
    const p = Number(r.chinchorro_precio_diario);
    if (!Number.isFinite(p) || p <= 0) return 0;
    return p * unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
}

function montoAbonadoReserva(r) {
    const a = Number(r.monto_abonado);
    return Number.isFinite(a) && a >= 0 ? a : 0;
}

function saldoReservaHabitacion(r) {
    const total = valorMonetarioReservaHabitacion(r);
    return Math.max(0, total - Math.min(montoAbonadoReserva(r), total));
}

function saldoReservaChinchorro(r) {
    const total = valorMonetarioReservaChinchorro(r);
    return Math.max(0, total - Math.min(montoAbonadoReserva(r), total));
}

function reservaTieneSaldoPendiente(r, fnSaldo) {
    return r.estado !== 'Cancelada' && !reservaEsNoShow(r) && fnSaldo(r) > 0.005;
}

function reservaEstaTotalizada(r, fnTotal) {
    const total = fnTotal(r);
    if (total <= 0) return false;
    return montoAbonadoReserva(r) >= total - 0.005;
}

function htmlCeldaPagoReserva(r, fnTotal, fnSaldo) {
    const total = fnTotal(r);
    const abonado = Math.min(montoAbonadoReserva(r), total);
    const saldo = fnSaldo(r);
    if (total <= 0) {
        return '<span class="muted">Sin tarifa</span>';
    }
    const badge = saldo <= 0.005
        ? '<span class="estado-badge estado-disponible" style="margin-left:4px">Pagado</span>'
        : '';
    return `
        <span class="txt-precio-small"><strong>${escapeHtmlCal(formatoMoneda(abonado))}</strong>${badge}</span>
    `;
}

function htmlCeldaSaldoReserva(r, fnSaldo) {
    const saldo = fnSaldo(r);
    if (saldo <= 0.005) {
        return '<span class="muted">—</span>';
    }
    return `<strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(saldo))}</strong>`;
}

function botonesPagoReserva(r, tipo, fnSaldo) {
    if (r.estado === 'Cancelada' || reservaEsNoShow(r)) return '';
    const id = Number(r.id);
    const saldo = fnSaldo(r);
    if (saldo <= 0.005) return '';
    const fnAbono = tipo === 'chinchorro' ? 'mostrarModalAbonoChinchorro' : 'mostrarModalAbonoHabitacion';
    const fnTotal = tipo === 'chinchorro' ? 'totalizarReservaChinchorroPago' : 'totalizarReservaHabitacionPago';
    return `
        <button type="button" class="btn-secondary btn-small btn-reserva" onclick="${fnAbono}(${id})" title="Registrar abono">💵 Abonar</button>
        <button type="button" class="btn-primary btn-small btn-reserva" onclick="${fnTotal}(${id})" title="Pagar saldo completo">✅ Totalizar</button>
    `;
}

function urlAbsolutaRecurso(url) {
    if (!url) return '';
    const s = String(url).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) return `${window.location.origin}${s}`;
    return s;
}

function datosMarcaHotelParaFactura() {
    const d = datosHotelCache || {};
    const elNombre = document.getElementById('hotelNombre');
    const nombre =
        (d.nombre && String(d.nombre).trim()) ||
        (elNombre && String(elNombre.textContent || '').trim()) ||
        'Mi Hotel';
    return {
        nombre,
        logoUrl: urlAbsolutaRecurso(d.logo_url)
    };
}

let facturaReservaDocumentoCache = '';

function estilosFacturaReservaHtml() {
    return `
        @page { size: 80mm auto; margin: 0; }
        * { box-sizing: border-box; }
        html, body {
            margin: 0;
            padding: 3mm 2mm;
            width: 80mm;
            max-width: 80mm;
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            line-height: 1.35;
            color: #000;
            background: #fff;
        }
        .factura-ticket { width: 100%; }
        .factura-cabecera { text-align: center; padding-bottom: 2px; }
        .factura-logo {
            display: block;
            margin: 0 auto 4px;
            max-width: 52mm;
            max-height: 16mm;
            object-fit: contain;
        }
        .factura-logo-placeholder { font-size: 1.6rem; line-height: 1; margin-bottom: 4px; }
        .factura-cabecera h1 {
            margin: 0 0 2px;
            font-size: 13px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.02em;
        }
        .factura-cabecera p { margin: 0; font-size: 10px; }
        .factura-sep { border-top: 1px dashed #000; margin: 5px 0; }
        .factura-seccion-titulo {
            font-weight: bold;
            text-align: center;
            margin: 3px 0;
            font-size: 10px;
            letter-spacing: 0.05em;
        }
        .factura-linea {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 6px;
            margin: 2px 0;
            word-break: break-word;
        }
        .factura-linea > span:first-child { flex: 1; min-width: 0; }
        .factura-linea > span:last-child { flex-shrink: 0; text-align: right; white-space: nowrap; }
        .factura-linea--sub { padding-left: 2mm; font-size: 10px; }
        .factura-linea--bloque { display: block; }
        .factura-linea--bloque > span { display: block; }
        .factura-linea--total { font-weight: bold; font-size: 12px; margin-top: 3px; }
        .factura-linea--saldo { font-weight: bold; }
        .factura-pie {
            text-align: center;
            font-size: 9px;
            margin-top: 6px;
            padding-top: 4px;
            border-top: 1px dashed #000;
        }
        .factura-dian {
            text-align: center;
            margin-top: 8px;
            padding-top: 6px;
            border-top: 1px dashed #000;
        }
        .factura-dian-titulo {
            font-weight: bold;
            font-size: 10px;
            margin-bottom: 4px;
        }
        .factura-qr {
            display: block;
            margin: 4px auto;
            width: 42mm;
            max-width: 100%;
            height: auto;
        }
        .factura-cufe {
            font-size: 8px;
            word-break: break-all;
            line-height: 1.25;
            margin-top: 4px;
            text-align: left;
        }
        .factura-dian-estado {
            font-size: 9px;
            margin-top: 4px;
        }
        @media print {
            html, body { padding: 2mm 2mm; width: 80mm; }
        }
    `;
}

function formatoFechaFactura(valor) {
    if (!valor) return new Date().toLocaleString('es-ES');
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleString('es-ES');
}

function construirFacturaReservaInnerHtml(r, tipo, comprobante) {
    const marca = datosMarcaHotelParaFactura();
    const esChin = tipo === 'chinchorro';
    const fnTotal = esChin ? valorMonetarioReservaChinchorro : valorMonetarioReservaHabitacion;
    const fnSaldo = esChin ? saldoReservaChinchorro : saldoReservaHabitacion;
    const total = fnTotal(r);
    const abonado = Math.min(montoAbonadoReserva(r), total);
    const saldo = fnSaldo(r);
    const unidades = unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
    const tarifa = Number(esChin ? r.chinchorro_precio_diario : r.habitacion_precio_diario) || 0;
    const unidadLabel = esChin ? etiquetaChinchorroReserva(r) : etiquetaHabitacionReserva(r);
    const tipoUnidad = esChin ? 'Chinchorro' : 'Habitación';
    const etiquetaPeriodo = esChin ? 'días' : 'noches';
    const huesped = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || '—';
    const fi = new Date(r.fecha_ingreso).toLocaleDateString('es-ES');
    const fs = new Date(r.fecha_salida).toLocaleDateString('es-ES');
    const prefijo = esChin ? 'CH' : 'HAB';
    const hotelDian = datosHotelCache || {};
    const numeroFactura =
        comprobante && (comprobante.numero_dian || comprobante.numero)
            ? escapeHtmlCal(comprobante.numero_dian || comprobante.numero)
            : '—';
    const lineaResolucion =
        comprobante && comprobante.dian_estado === 'aceptado' && hotelDian.dian_resolucion
            ? `<div class="factura-linea factura-linea--sub"><span>RESOLUCION DIAN</span><span>${escapeHtmlCal(hotelDian.dian_resolucion)}</span></div>`
            : '';
    const fechaEmision = formatoFechaFactura(comprobante && comprobante.fecha_emision);
    const refReserva = `${prefijo}-${r.id}`;
    const logoHtml = marca.logoUrl
        ? `<img src="${escapeHtmlCal(marca.logoUrl)}" alt="Logo" class="factura-logo">`
        : `<div class="factura-logo-placeholder" aria-hidden="true">🏨</div>`;
    const conceptoEstadia = `Estadía ${esChin ? 'chinchorro' : 'habitación'}`;
    const detalleTarifa = `${unidades} ${etiquetaPeriodo} x ${escapeHtmlCal(formatoMoneda(tarifa))}`;
    const lineaSaldo =
        saldo > 0.005
            ? `<div class="factura-linea factura-linea--saldo"><span>SALDO PENDIENTE</span><span>${escapeHtmlCal(formatoMoneda(saldo))}</span></div>`
            : `<div class="factura-linea"><span>ESTADO PAGO</span><span>PAGADO</span></div>`;

    const tieneDian =
        comprobante &&
        comprobante.dian_estado === 'aceptado' &&
        comprobante.cufe;
    const qrSrc =
        comprobante && comprobante.qr_imagen
            ? comprobante.qr_imagen
            : comprobante && comprobante.id
              ? `${window.location.origin}/api/comprobantes/${comprobante.id}/qr.png`
              : '';
    const bloqueDian = tieneDian
        ? `
        <div class="factura-sep"></div>
        <div class="factura-dian">
            <div class="factura-dian-titulo">FACTURA ELECTRONICA DIAN</div>
            <img class="factura-qr" src="${escapeHtmlCal(qrSrc)}" alt="QR DIAN">
            <div class="factura-cufe"><strong>CUFE:</strong> ${escapeHtmlCal(comprobante.cufe)}</div>
            <div class="factura-dian-estado">${escapeHtmlCal(comprobante.dian_respuesta || 'Validado DIAN')}</div>
        </div>`
        : '';

    return `
    <div class="factura-ticket">
        <header class="factura-cabecera">
            ${logoHtml}
            <h1>${escapeHtmlCal(marca.nombre)}</h1>
            <p>COMPROBANTE DE RESERVA</p>
        </header>
        <div class="factura-sep"></div>
        <div class="factura-linea factura-linea--total"><span>NO. FACTURA</span><span>${numeroFactura}</span></div>
        ${lineaResolucion}
        <div class="factura-linea"><span>REF. RESERVA</span><span>${refReserva}</span></div>
        <div class="factura-linea"><span>FECHA EMISION</span><span>${escapeHtmlCal(fechaEmision)}</span></div>
        <div class="factura-linea"><span>ESTADO</span><span>${escapeHtmlCal(r.estado || '—')}</span></div>
        <div class="factura-sep"></div>
        <div class="factura-seccion-titulo">DATOS DEL CLIENTE</div>
        <div class="factura-linea"><span>HUESPED</span><span>${escapeHtmlCal(huesped)}</span></div>
        <div class="factura-linea"><span>${tipoUnidad.toUpperCase()}</span><span>${escapeHtmlCal(unidadLabel)}</span></div>
        <div class="factura-linea"><span>ADULTOS / NINOS</span><span>${Number(r.adultos || 1)} / ${Number(r.ninos || 0)}</span></div>
        <div class="factura-linea"><span>INGRESO</span><span>${escapeHtmlCal(fi)}</span></div>
        <div class="factura-linea"><span>SALIDA</span><span>${escapeHtmlCal(fs)}</span></div>
        <div class="factura-linea"><span>METODO PAGO</span><span>${escapeHtmlCal(r.metodo_pago || '—')}</span></div>
        ${
            r.observaciones
                ? `<div class="factura-linea factura-linea--bloque"><span>OBS: ${escapeHtmlCal(r.observaciones)}</span></div>`
                : ''
        }
        <div class="factura-sep"></div>
        <div class="factura-seccion-titulo">DETALLE</div>
        <div class="factura-linea"><span>${conceptoEstadia}</span><span>${escapeHtmlCal(formatoMoneda(total))}</span></div>
        <div class="factura-linea factura-linea--sub"><span>${detalleTarifa}</span><span></span></div>
        <div class="factura-sep"></div>
        <div class="factura-linea factura-linea--total"><span>TOTAL</span><span>${escapeHtmlCal(formatoMoneda(total))}</span></div>
        <div class="factura-linea"><span>ABONADO</span><span>${escapeHtmlCal(formatoMoneda(abonado))}</span></div>
        ${lineaSaldo}
        ${bloqueDian}
        <footer class="factura-pie">
            ${escapeHtmlCal(marca.nombre)}<br>
            Gracias por su preferencia
        </footer>
    </div>`;
}

function construirFacturaReservaDocumento(r, tipo, comprobante) {
    const inner = construirFacturaReservaInnerHtml(r, tipo, comprobante);
    const prefijo = tipo === 'chinchorro' ? 'CH' : 'HAB';
    const num = (comprobante && comprobante.numero) || `${prefijo}-${r.id}`;
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Factura ${num} - ${prefijo}-${r.id}</title>
    <style>${estilosFacturaReservaHtml()}</style>
</head>
<body>${inner}</body>
</html>`;
}

function esperarImagenesEnDocumento(doc, callback, tiempoMaxMs = 4000) {
    const imgs = doc ? doc.querySelectorAll('img') : [];
    if (!imgs.length) {
        setTimeout(callback, 200);
        return;
    }
    let pendientes = imgs.length;
    let listo = false;
    const finalizar = () => {
        if (listo) return;
        listo = true;
        setTimeout(callback, 200);
    };
    const revisar = () => {
        pendientes -= 1;
        if (pendientes <= 0) finalizar();
    };
    imgs.forEach((img) => {
        if (img.complete) revisar();
        else {
            img.addEventListener('load', revisar, { once: true });
            img.addEventListener('error', revisar, { once: true });
        }
    });
    setTimeout(finalizar, tiempoMaxMs);
}

function esperarImagenesEnContenedor(contenedor) {
    return new Promise((resolve) => {
        if (!contenedor) {
            resolve();
            return;
        }
        const imgs = contenedor.querySelectorAll('img');
        if (!imgs.length) {
            resolve();
            return;
        }
        let pendientes = imgs.length;
        const revisar = () => {
            pendientes -= 1;
            if (pendientes <= 0) resolve();
        };
        imgs.forEach((img) => {
            if (img.complete) revisar();
            else {
                img.addEventListener('load', revisar, { once: true });
                img.addEventListener('error', revisar, { once: true });
            }
        });
        setTimeout(resolve, 4000);
    });
}

function ejecutarImpresionFacturaReserva() {
    if (!facturaReservaDocumentoCache) {
        alert('No hay factura lista para imprimir.');
        return;
    }
    const iframeAnterior = document.getElementById('iframeImpresionFactura');
    if (iframeAnterior) iframeAnterior.remove();

    const iframe = document.createElement('iframe');
    iframe.id = 'iframeImpresionFactura';
    iframe.setAttribute('title', 'Impresión de factura');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);

    const ventana = iframe.contentWindow;
    const doc = ventana.document;
    doc.open();
    doc.write(facturaReservaDocumentoCache);
    doc.close();

    esperarImagenesEnDocumento(doc, () => {
        try {
            ventana.focus();
            ventana.print();
        } catch (e) {
            console.error(e);
            alert('No se pudo abrir el diálogo de impresión.');
        }
        setTimeout(() => iframe.remove(), 1500);
    });
}

async function asegurarDatosHotelFactura() {
    if (!datosHotelCache) {
        try {
            const response = await fetchWithAuth(`${API_URL}/hotel`);
            if (response.ok) {
                datosHotelCache = await response.json();
            }
        } catch (e) {
            console.warn('No se pudo cargar datos del hotel para la factura:', e);
        }
    }
}

function obtenerReservaParaFactura(tipo, id) {
    return tipo === 'chinchorro'
        ? reservasChinchorros.find((x) => Number(x.id) === Number(id))
        : reservas.find((x) => Number(x.id) === Number(id));
}

async function mostrarFacturaReservaEnModal(r, tipo, comprobante, autoImprimir) {
    const contenedor = document.getElementById('facturaReservaContenido');
    const modal = document.getElementById('modalFacturaReserva');
    const titulo = document.getElementById('tituloModalFactura');
    if (!contenedor || !modal) {
        alert('No se pudo abrir la vista de factura.');
        return;
    }
    if (titulo) {
        titulo.textContent =
            comprobante && comprobante.dian_estado === 'aceptado'
                ? `Factura DIAN ${comprobante.numero || ''}`
                : 'Vista previa — ticket 80 mm';
    }

    facturaReservaDocumentoCache = construirFacturaReservaDocumento(r, tipo, comprobante);
    contenedor.innerHTML = construirFacturaReservaInnerHtml(r, tipo, comprobante);
    modal.classList.add('active');
    await esperarImagenesEnContenedor(contenedor);
    if (autoImprimir) {
        ejecutarImpresionFacturaReserva();
    }
}

function dianEnvioAutomaticoActivo(hotel) {
    const h = hotel || datosHotelCache || {};
    return h.dian_envio_automatico === 1 || h.dian_envio_automatico === true || h.dian_envio_automatico === '1';
}

function mostrarBotonDianManualEnReservas() {
    return !dianEnvioAutomaticoActivo(datosHotelCache);
}

async function enviarFacturaDianInterno(tipo, id, opciones = {}) {
    const { confirmar = true, autoImprimir = false, mostrarAlertaExito = true } = opciones;
    await asegurarDatosHotelFactura();
    const r = obtenerReservaParaFactura(tipo, id);
    if (!r) {
        alert('No se encontró la reserva.');
        return false;
    }

    if (!hotelTieneResolucionDianCliente(datosHotelCache)) {
        alert(
            'Configure primero la resolución DIAN en Configuración → Facturación electrónica DIAN (NIT, resolución, prefijo, rango y clave técnica).'
        );
        return false;
    }

    if (confirmar && !confirm('¿Enviar esta reserva a la DIAN y generar factura electrónica con CUFE y código QR?')) {
        return false;
    }

    try {
        const resp = await fetchWithAuth(`${API_URL}/comprobantes/reserva/dian`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo, reserva_id: id })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            alert(data.error || 'No se pudo enviar la factura a la DIAN.');
            return false;
        }
        const comprobante = {
            ...data.comprobante,
            numero_dian: data.comprobante.numero_dian || data.comprobante.numero
        };
        await mostrarFacturaReservaEnModal(r, tipo, comprobante, autoImprimir);
        if (mostrarAlertaExito && !autoImprimir) {
            alert(
                (data.dian && data.dian.mensaje) ||
                    `Factura ${comprobante.numero_dian || comprobante.numero} aceptada por DIAN. CUFE y QR agregados.`
            );
        }
        return true;
    } catch (e) {
        console.error(e);
        alert('Error de conexión al enviar a la DIAN.');
        return false;
    }
}

async function imprimirFacturaReserva(tipo, id) {
    await asegurarDatosHotelFactura();
    const r = obtenerReservaParaFactura(tipo, id);
    if (!r) {
        alert('No se encontró la reserva.');
        return;
    }

    if (dianEnvioAutomaticoActivo(datosHotelCache) && hotelTieneResolucionDianCliente(datosHotelCache)) {
        await enviarFacturaDianInterno(tipo, id, {
            confirmar: false,
            autoImprimir: true,
            mostrarAlertaExito: false
        });
        return;
    }

    let comprobante = null;
    try {
        const respComp = await fetchWithAuth(`${API_URL}/comprobantes/reserva`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo, reserva_id: id })
        });
        const dataComp = await respComp.json().catch(() => ({}));
        if (!respComp.ok) {
            const msg =
                dataComp.error ||
                (respComp.status === 404
                    ? 'El servidor no tiene la versión actualizada. Reinicie con npm start y recargue la página (Ctrl+F5).'
                    : 'No se pudo asignar el consecutivo de la factura.');
            alert(msg);
            return;
        }
        comprobante = dataComp;
    } catch (e) {
        console.error(e);
        alert('Error de conexión al generar el consecutivo de la factura.');
        return;
    }

    await mostrarFacturaReservaEnModal(r, tipo, comprobante, true);
}

async function enviarFacturaDianReserva(tipo, id) {
    await enviarFacturaDianInterno(tipo, id, {
        confirmar: true,
        autoImprimir: false,
        mostrarAlertaExito: true
    });
}

function htmlAccionesReservaHabitacion(reserva) {
    const id = Number(reserva.id);
    const activa = reserva.estado === 'Activa';
    const pendienteCheckin = reservaPendienteCheckin(reserva);
    const puedeGestionar = activa || pendienteCheckin;
    return `
        <td class="td-acciones-reserva">
            <div class="reserva-acciones">
                <div class="reserva-acciones-grupo">
                    ${
                        pendienteCheckin
                            ? `<button type="button" class="btn-primary btn-small btn-reserva" onclick="confirmarCheckinReserva(${id})" title="Confirmar llegada del huésped">✅ Check-in</button>`
                            : ''
                    }
                    <button type="button" class="btn-secondary btn-small btn-reserva" onclick="modificarReserva(${id})" title="Modificar reserva">✏️ Modificar</button>
                    <button type="button" class="btn-secondary btn-small btn-reserva" onclick="imprimirFacturaReserva('habitacion', ${id})" title="Imprimir factura${dianEnvioAutomaticoActivo() ? ' (envía a DIAN automático)' : ''}">🖨️ Imprimir</button>
                    ${
                        mostrarBotonDianManualEnReservas()
                            ? `<button type="button" class="btn-secondary btn-small btn-reserva" onclick="enviarFacturaDianReserva('habitacion', ${id})" title="Enviar a DIAN">📤 DIAN</button>`
                            : ''
                    }
                    ${botonesPagoReserva(reserva, 'habitacion', saldoReservaHabitacion)}
                </div>
                <div class="reserva-acciones-grupo reserva-acciones-grupo--fin">
                    ${
                        puedeGestionar
                            ? `<button type="button" class="btn-secondary btn-small btn-reserva" onclick="cancelarReserva(${id})" title="Cancelar reserva">❌ Cancelar</button>`
                            : ''
                    }
                    <button type="button" class="btn-danger btn-small btn-reserva" onclick="eliminarReserva(${id})" title="Eliminar reserva">🗑️ Eliminar</button>
                </div>
            </div>
        </td>
    `;
}

function htmlAccionesReservaChinchorro(r) {
    const id = Number(r.id);
    const activa = r.estado === 'Activa';
    return `
        <td class="td-acciones-reserva">
            <div class="reserva-acciones">
                <div class="reserva-acciones-grupo">
                    <button type="button" class="btn-secondary btn-small btn-reserva" onclick="modificarReservaChinchorro(${id})" title="Modificar reserva">✏️ Modificar</button>
                    <button type="button" class="btn-secondary btn-small btn-reserva" onclick="imprimirFacturaReserva('chinchorro', ${id})" title="Imprimir factura${dianEnvioAutomaticoActivo() ? ' (envía a DIAN automático)' : ''}">🖨️ Imprimir</button>
                    ${
                        mostrarBotonDianManualEnReservas()
                            ? `<button type="button" class="btn-secondary btn-small btn-reserva" onclick="enviarFacturaDianReserva('chinchorro', ${id})" title="Enviar a DIAN">📤 DIAN</button>`
                            : ''
                    }
                    ${botonesPagoReserva(r, 'chinchorro', saldoReservaChinchorro)}
                </div>
                <div class="reserva-acciones-grupo reserva-acciones-grupo--fin">
                    ${
                        activa
                            ? `<button type="button" class="btn-secondary btn-small btn-reserva" onclick="cancelarReservaChinchorro(${id})" title="Cancelar reserva">❌ Cancelar</button>`
                            : ''
                    }
                    <button type="button" class="btn-danger btn-small btn-reserva" onclick="eliminarReservaChinchorro(${id})" title="Eliminar reserva">🗑️ Eliminar</button>
                </div>
            </div>
        </td>
    `;
}

function sumarValoresReservas(lista, fnValor) {
    return lista.reduce((acc, r) => acc + fnValor(r), 0);
}

function calcularResumenFinancieroReservas() {
    const habNoCancel = reservas.filter((r) => r.estado !== 'Cancelada');
    const chinNoCancel = reservasChinchorros.filter((r) => r.estado !== 'Cancelada');
    const habActivas = reservas.filter((r) => r.estado === 'Activa');
    const chinActivas = reservasChinchorros.filter((r) => r.estado === 'Activa');

    const ingresosHab = sumarValoresReservas(habNoCancel, valorMonetarioReservaHabitacion);
    const ingresosChin = sumarValoresReservas(chinNoCancel, valorMonetarioReservaChinchorro);
    const pagadoHab = sumarValoresReservas(habNoCancel, (r) => Math.min(montoAbonadoReserva(r), valorMonetarioReservaHabitacion(r)));
    const pagadoChin = sumarValoresReservas(chinNoCancel, (r) => Math.min(montoAbonadoReserva(r), valorMonetarioReservaChinchorro(r)));
    const adeudadoHab = sumarValoresReservas(habActivas, saldoReservaHabitacion);
    const adeudadoChin = sumarValoresReservas(chinActivas, saldoReservaChinchorro);

    return {
        ingresosTotales: ingresosHab + ingresosChin,
        pagado: pagadoHab + pagadoChin,
        adeudado: adeudadoHab + adeudadoChin,
        ingresosHab,
        ingresosChin,
        pagadoHab,
        pagadoChin,
        adeudadoHab,
        adeudadoChin,
        countHab: habNoCancel.length,
        countChin: chinNoCancel.length
    };
}

function htmlFinCard(clase, etiqueta, monto, detalle) {
    return `
        <article class="fin-card ${clase}">
            <p class="fin-card-label">${etiqueta}</p>
            <p class="fin-card-monto">${formatoMoneda(monto)}</p>
            ${detalle ? `<p class="fin-card-detalle">${detalle}</p>` : ''}
        </article>
    `;
}

function tarifaDiariaReservaHabitacion(r) {
    const p = Number(r.habitacion_precio_diario);
    return Number.isFinite(p) && p > 0 ? p : 0;
}

function tarifaDiariaReservaChinchorro(r) {
    const p = Number(r.chinchorro_precio_diario);
    return Number.isFinite(p) && p > 0 ? p : 0;
}

function ymdReservaIngreso(r) {
    return String(r.fecha_ingreso).slice(0, 10);
}

function ymdReservaSalida(r) {
    return String(r.fecha_salida).slice(0, 10);
}

function ymdEnRangoReserva(ymd, ing, sal) {
    return ymd >= ing && ymd <= sal;
}

function reservaActivaEnFecha(r, ymd) {
    if (!r || r.estado === 'Cancelada' || r.estado === 'Finalizada' || reservaEsNoShow(r)) return false;
    if (!ymdEnRangoReserva(ymd, ymdReservaIngreso(r), ymdReservaSalida(r))) return false;
    if (reservaPendienteCheckin(r)) {
        return ymd === ymdReservaIngreso(r);
    }
    if (String(r.estado) === 'Activa') {
        if (reservaEstaConCheckin(r)) return true;
        return ymd < ymdReservaIngreso(r);
    }
    return false;
}

function reservaOcupadaEnFecha(r, ymd) {
    return reservaEstaConCheckin(r) && ymdEnRangoReserva(ymd, ymdReservaIngreso(r), ymdReservaSalida(r));
}

function reservaPendienteCheckinEnFecha(r, ymd) {
    return reservaPendienteCheckin(r) && ymd === ymdReservaIngreso(r);
}

function reservaFuturaConfirmadaEnFecha(r, ymd) {
    return (
        String(r.estado) === 'Activa' &&
        !r.checkin_at &&
        ymd < ymdReservaIngreso(r) &&
        ymdEnRangoReserva(ymd, ymdReservaIngreso(r), ymdReservaSalida(r))
    );
}

function contarDiasSolapadosYMD(ing, sal, desdeYmd, hastaYmd) {
    const start = ing > desdeYmd ? ing : desdeYmd;
    const end = sal < hastaYmd ? sal : hastaYmd;
    if (start > end) return 0;
    let count = 0;
    const cur = new Date(`${start}T12:00:00`);
    const endD = new Date(`${end}T12:00:00`);
    while (cur <= endD) {
        count += 1;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

function rangoMesActualYMD() {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const primero = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const ultimoDia = new Date(y, m + 1, 0).getDate();
    const ultimo = `${y}-${String(m + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    return { primero, ultimo, etiqueta: NOMBRES_MES_CAL[m] };
}

function inicioSemanaActualYMD(hoyYmd) {
    const d = new Date(`${hoyYmd}T12:00:00`);
    const dow = d.getDay();
    const diff = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - diff);
    return fechaLocalYMD(d);
}

function finSemanaActualYMD(hoyYmd) {
    const d = new Date(`${inicioSemanaActualYMD(hoyYmd)}T12:00:00`);
    d.setDate(d.getDate() + 6);
    return fechaLocalYMD(d);
}

function listarDiasEntreYMD(desde, hasta) {
    const out = [];
    const cur = new Date(`${desde}T12:00:00`);
    const end = new Date(`${hasta}T12:00:00`);
    while (cur <= end) {
        out.push(fechaLocalYMD(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return out;
}

function recursosOcupadosEnFecha(ymd) {
    const ids = new Set();
    reservas.forEach((r) => {
        if (reservaOcupadaEnFecha(r, ymd)) ids.add(`h-${r.habitacion_id}`);
    });
    reservasChinchorros.forEach((r) => {
        if (reservaActivaEnFecha(r, ymd)) ids.add(`c-${r.chinchorro_id}`);
    });
    return ids.size;
}

function ocupacionPorcentajeEnFecha(ymd) {
    const total = habitaciones.length + chinchorros.length;
    if (!total) return 0;
    return pct(recursosOcupadosEnFecha(ymd), total);
}

function ocupacionPromedioEnDias(diasYmd) {
    if (!diasYmd.length) return 0;
    const suma = diasYmd.reduce((acc, ymd) => acc + ocupacionPorcentajeEnFecha(ymd), 0);
    return Math.round(suma / diasYmd.length);
}

function personasHospedadasEnFecha(ymd) {
    const ids = new Set();
    reservas.forEach((r) => {
        if (reservaOcupadaEnFecha(r, ymd) && r.huesped_id != null) ids.add(`h-${r.huesped_id}`);
    });
    reservasChinchorros.forEach((r) => {
        if (reservaActivaEnFecha(r, ymd) && r.huesped_id != null) ids.add(`c-${r.huesped_id}`);
    });
    return ids.size;
}

function ingresosDelDia(ymd) {
    let total = 0;
    reservas.forEach((r) => {
        if (reservaOcupadaEnFecha(r, ymd)) total += tarifaDiariaReservaHabitacion(r);
    });
    reservasChinchorros.forEach((r) => {
        if (reservaActivaEnFecha(r, ymd)) total += tarifaDiariaReservaChinchorro(r);
    });
    return total;
}

function ingresosReservaEnRango(r, desdeYmd, hastaYmd, tarifaFn) {
    if (r.estado === 'Cancelada') return 0;
    const dias = contarDiasSolapadosYMD(ymdReservaIngreso(r), ymdReservaSalida(r), desdeYmd, hastaYmd);
    return dias * tarifaFn(r);
}

function ingresosMesActual() {
    const { primero, ultimo } = rangoMesActualYMD();
    let total = 0;
    reservas.forEach((r) => {
        total += ingresosReservaEnRango(r, primero, ultimo, tarifaDiariaReservaHabitacion);
    });
    reservasChinchorros.forEach((r) => {
        total += ingresosReservaEnRango(r, primero, ultimo, tarifaDiariaReservaChinchorro);
    });
    return total;
}

function ingresosPorHabitacionMesMap() {
    const { primero, ultimo } = rangoMesActualYMD();
    const map = new Map();
    habitaciones.forEach((h) => {
        const label = h.numero ? `Habitación ${h.numero}` : `Habitación #${h.id}`;
        map.set(Number(h.id), { label, total: 0 });
    });
    reservas.forEach((r) => {
        const id = Number(r.habitacion_id);
        if (!map.has(id)) {
            map.set(id, {
                label: r.habitacion_numero ? `Habitación ${r.habitacion_numero}` : `Habitación #${id}`,
                total: 0
            });
        }
        const row = map.get(id);
        row.total += ingresosReservaEnRango(r, primero, ultimo, tarifaDiariaReservaHabitacion);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

function ingresosPorChinchorroMesMap() {
    const { primero, ultimo } = rangoMesActualYMD();
    const map = new Map();
    chinchorros.forEach((c) => {
        const label = c.codigo ? `Chinchorro ${c.codigo}` : `Chinchorro #${c.id}`;
        map.set(Number(c.id), { label, total: 0 });
    });
    reservasChinchorros.forEach((r) => {
        const id = Number(r.chinchorro_id);
        if (!map.has(id)) {
            map.set(id, {
                label: r.chinchorro_codigo ? `Chinchorro ${r.chinchorro_codigo}` : `Chinchorro #${id}`,
                total: 0
            });
        }
        const row = map.get(id);
        row.total += ingresosReservaEnRango(r, primero, ultimo, tarifaDiariaReservaChinchorro);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

function htmlDashKpiCard(etiqueta, valor, claseColor, esMoneda) {
    const display = esMoneda ? formatoMoneda(valor) : String(valor);
    return `
        <article class="dash-kpi-card">
            <p class="dash-kpi-label">${etiqueta}</p>
            <p class="dash-kpi-valor ${claseColor}">${display}</p>
        </article>
    `;
}

function renderDashboardKpis() {
    const grid = document.getElementById('dashboardKpiGrid');
    if (!grid) return;

    const hoy = fechaLocalYMD();
    const semIni = inicioSemanaActualYMD(hoy);
    const semFin = finSemanaActualYMD(hoy);
    const diasSemana = listarDiasEntreYMD(semIni, hoy > semFin ? semFin : hoy);
    const { primero, ultimo } = rangoMesActualYMD();
    const diasMes = listarDiasEntreYMD(primero, hoy > ultimo ? ultimo : hoy);

    const reservasActivas =
        reservas.filter((r) => r.estado === 'Activa').length +
        reservasChinchorros.filter((r) => r.estado === 'Activa').length;
    const clientesTotales = huespedes.length;

    grid.innerHTML = `
        ${htmlDashKpiCard('Ocupación hoy', `${ocupacionPorcentajeEnFecha(hoy)}%`, 'dash-kpi--blue', false)}
        ${htmlDashKpiCard('Ocupación mensual', `${ocupacionPromedioEnDias(diasMes)}%`, 'dash-kpi--purple', false)}
        ${htmlDashKpiCard('Ocupación semanal', `${ocupacionPromedioEnDias(diasSemana)}%`, 'dash-kpi--indigo', false)}
        ${htmlDashKpiCard('Personas hospedadas hoy', personasHospedadasEnFecha(hoy), 'dash-kpi--teal', false)}
        ${htmlDashKpiCard('Ingresos hoy', ingresosDelDia(hoy), 'dash-kpi--green', true)}
        ${htmlDashKpiCard('Ingresos mes', ingresosMesActual(), 'dash-kpi--orange', true)}
        ${htmlDashKpiCard('Reservas activas', reservasActivas, 'dash-kpi--red', false)}
        ${htmlDashKpiCard('Clientes totales', clientesTotales, 'dash-kpi--slate', false)}
    `;
}

function renderIngresosPorRecursoMes() {
    const elH = document.getElementById('ingresosPorHabitacionMes');
    const elC = document.getElementById('ingresosPorChinchorroMes');
    const filasH = ingresosPorHabitacionMesMap();
    const filasC = ingresosPorChinchorroMesMap();

    const htmlGrid = (filas, vacio) => {
        if (!filas.length) {
            return `<p class="dash-sin-datos">${vacio}</p>`;
        }
        return filas
            .map(
                (f) => `
            <div class="dash-ingreso-item">
                <span class="dash-ingreso-nombre">${escapeHtmlCal(f.label)}</span>
                <span class="dash-ingreso-monto">${escapeHtmlCal(formatoMoneda(f.total))}</span>
            </div>`
            )
            .join('');
    };

    if (elH) elH.innerHTML = htmlGrid(filasH, 'No hay habitaciones registradas.');
    if (elC) elC.innerHTML = htmlGrid(filasC, 'No hay chinchorros registrados.');
}

function renderUltimasReservasDash() {
    const cont = document.getElementById('ultimasReservasDash');
    if (!cont) return;

    const items = [];
    reservas.forEach((r) => {
        items.push({
            tipo: 'Habitación',
            recurso: r.habitacion_numero ? `Hab. ${r.habitacion_numero}` : `Hab. #${r.habitacion_id}`,
            huesped: `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || '—',
            ingreso: ymdReservaIngreso(r),
            salida: ymdReservaSalida(r),
            estado: r.estado,
            id: Number(r.id)
        });
    });
    reservasChinchorros.forEach((r) => {
        items.push({
            tipo: 'Chinchorro',
            recurso: r.chinchorro_codigo ? `Chin. ${r.chinchorro_codigo}` : `Chin. #${r.chinchorro_id}`,
            huesped: `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || '—',
            ingreso: ymdReservaIngreso(r),
            salida: ymdReservaSalida(r),
            estado: r.estado,
            id: Number(r.id)
        });
    });

    items.sort((a, b) => b.id - a.id);
    const ultimas = items.slice(0, 8);

    if (!ultimas.length) {
        cont.innerHTML = '<p class="dash-sin-datos">Aún no hay reservas registradas.</p>';
        return;
    }

    cont.innerHTML = `
        <table class="data-table dash-tabla-ultimas">
            <thead>
                <tr>
                    <th>Tipo</th>
                    <th>Recurso</th>
                    <th>Huésped</th>
                    <th>Ingreso</th>
                    <th>Salida</th>
                    <th>Estado</th>
                </tr>
            </thead>
            <tbody>
                ${ultimas
                    .map(
                        (u) => `
                <tr>
                    <td>${escapeHtmlCal(u.tipo)}</td>
                    <td><strong>${escapeHtmlCal(u.recurso)}</strong></td>
                    <td>${escapeHtmlCal(u.huesped)}</td>
                    <td>${escapeHtmlCal(u.ingreso)}</td>
                    <td>${escapeHtmlCal(u.salida)}</td>
                    <td>${escapeHtmlCal(u.estado)}</td>
                </tr>`
                    )
                    .join('')}
            </tbody>
        </table>
    `;
}

function renderIndicadoresDashboard() {
    renderDashboardKpis();
    renderIngresosPorRecursoMes();
    renderUltimasReservasDash();
}

function renderIndicadoresFinanciero() {
    const panel = document.getElementById('indicadoresFinancieros');
    if (!panel) return;

    const f = calcularResumenFinancieroReservas();
    const detHabIng = `Habitaciones: ${formatoMoneda(f.ingresosHab)} · ${f.countHab} reserva(s)`;
    const detChinIng = `Chinchorros: ${formatoMoneda(f.ingresosChin)} · ${f.countChin} reserva(s)`;

    panel.innerHTML = `
        <div class="fin-estado-grid">
            ${htmlFinCard('fin-ingresos', 'Ingresos Totales', f.ingresosTotales, `${detHabIng}<br>${detChinIng}`)}
            ${htmlFinCard('fin-pagado', 'Pagado (abonado)', f.pagado, `Abonos registrados · Hab. ${formatoMoneda(f.pagadoHab)} · Chin. ${formatoMoneda(f.pagadoChin)}`)}
            ${htmlFinCard('fin-adeudado', 'Adeudado (saldo)', f.adeudado, `Saldo pendiente en activas · Hab. ${formatoMoneda(f.adeudadoHab)} · Chin. ${formatoMoneda(f.adeudadoChin)}`)}
        </div>
        <p class="fin-estado-nota">
            Los montos se calculan con la tarifa registrada en cada reserva (noches × tarifa/noche o días × tarifa/día).
            <strong>Pagado</strong> = suma de abonos registrados; <strong>Adeudado</strong> = saldo pendiente en reservas activas.
            Use <strong>Abonar</strong> o <strong>Totalizar</strong> en el listado de reservas para registrar pagos.
        </p>
    `;
}

function reservaEsActivaOperativa(r) {
    const est = String(r.estado || '');
    return est === 'Activa' || est === 'Pendiente de Check-in';
}

function reservasHabitacionAlojadasEnFecha(ymd) {
    return reservas
        .filter((r) => reservaOcupadaEnFecha(r, ymd) || reservaPendienteCheckinEnFecha(r, ymd))
        .sort((a, b) =>
            etiquetaHabitacionReserva(a).localeCompare(etiquetaHabitacionReserva(b), 'es', { sensitivity: 'base' })
        );
}

function reservasChinchorroAlojadasEnFecha(ymd) {
    return reservasChinchorros
        .filter((r) => reservaActivaEnFecha(r, ymd))
        .sort((a, b) =>
            etiquetaChinchorroReserva(a).localeCompare(etiquetaChinchorroReserva(b), 'es', { sensitivity: 'base' })
        );
}

function fechaAcomodacionOperativaActual() {
    const input = document.getElementById('fechaAcomodacionOperativa');
    if (input && input.value) return input.value;
    return fechaLocalYMD();
}

function inicializarGestionOperativa() {
    const input = document.getElementById('fechaAcomodacionOperativa');
    if (input && !input.value) {
        input.value = fechaLocalYMD();
    }
}

function consultarAcomodacionHoy() {
    const input = document.getElementById('fechaAcomodacionOperativa');
    if (input) input.value = fechaLocalYMD();
    renderAcomodacionOperativa();
}

function htmlFilaAcomodacionHabitacion(r) {
    const total = valorMonetarioReservaHabitacion(r);
    const saldo = saldoReservaHabitacion(r);
    const abonado = Math.min(montoAbonadoReserva(r), total);
    const salida = new Date(`${ymdReservaSalida(r)}T12:00:00`).toLocaleDateString('es-ES');
    const noches = unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
    const tarifa = Number(r.habitacion_precio_diario) || 0;
    const huesped = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || 'Huésped';
    const estado = reservaPendienteCheckin(r) ? 'Pendiente check-in' : 'Alojado';
    const saldoHtml =
        saldo > 0.005
            ? `<strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(saldo))}</strong>`
            : '<span class="muted">—</span>';
    return `
        <tr>
            <td>Habitación</td>
            <td><strong>${escapeHtmlCal(etiquetaHabitacionReserva(r))}</strong></td>
            <td>${escapeHtmlCal(huesped)}</td>
            <td>${escapeHtmlCal(textoPersonasReservaHabitacion(r))}</td>
            <td>${escapeHtmlCal(salida)}</td>
            <td><span class="estado-badge ${reservaPendienteCheckin(r) ? 'estado-pendiente' : 'estado-ocupada'}">${estado}</span></td>
            <td>${escapeHtmlCal(formatoMoneda(tarifa))}</td>
            <td><strong>${escapeHtmlCal(formatoMoneda(total))}</strong> <span class="muted">(${noches} noches)</span></td>
            <td>${escapeHtmlCal(formatoMoneda(abonado))}</td>
            <td>${saldoHtml}</td>
        </tr>`;
}

function htmlFilaAcomodacionChinchorro(r) {
    const total = valorMonetarioReservaChinchorro(r);
    const saldo = saldoReservaChinchorro(r);
    const abonado = Math.min(montoAbonadoReserva(r), total);
    const salida = new Date(`${ymdReservaSalida(r)}T12:00:00`).toLocaleDateString('es-ES');
    const dias = unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
    const tarifa = Number(r.chinchorro_precio_diario) || 0;
    const huesped = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || 'Huésped';
    const adultos = Number(r.adultos || 1);
    const ninos = Number(r.ninos || 0);
    const saldoHtml =
        saldo > 0.005
            ? `<strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(saldo))}</strong>`
            : '<span class="muted">—</span>';
    return `
        <tr>
            <td>Chinchorro</td>
            <td><strong>${escapeHtmlCal(etiquetaChinchorroReserva(r))}</strong></td>
            <td>${escapeHtmlCal(huesped)}</td>
            <td>${adultos} adulto(s)${ninos > 0 ? `, ${ninos} niño(s)` : ''}</td>
            <td>${escapeHtmlCal(salida)}</td>
            <td><span class="estado-badge estado-ocupada">En uso</span></td>
            <td>${escapeHtmlCal(formatoMoneda(tarifa))}</td>
            <td><strong>${escapeHtmlCal(formatoMoneda(total))}</strong> <span class="muted">(${dias} días)</span></td>
            <td>${escapeHtmlCal(formatoMoneda(abonado))}</td>
            <td>${saldoHtml}</td>
        </tr>`;
}

function renderAcomodacionOperativa() {
    const panel = document.getElementById('panelAcomodacionOperativa');
    if (!panel) return;

    const ymd = fechaAcomodacionOperativaActual();
    const listaHab = reservasHabitacionAlojadasEnFecha(ymd);
    const listaChin = reservasChinchorroAlojadasEnFecha(ymd);
    const fechaFmt = new Date(`${ymd}T12:00:00`).toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    if (listaHab.length === 0 && listaChin.length === 0) {
        panel.innerHTML = `
            <p class="gestion-vacio">No hay huéspedes alojados el <strong>${escapeHtmlCal(fechaFmt)}</strong>.</p>
        `;
        return;
    }

    let sumTotal = 0;
    let sumSaldo = 0;
    let sumAbonado = 0;
    listaHab.forEach((r) => {
        const total = valorMonetarioReservaHabitacion(r);
        sumTotal += total;
        sumSaldo += saldoReservaHabitacion(r);
        sumAbonado += Math.min(montoAbonadoReserva(r), total);
    });
    listaChin.forEach((r) => {
        const total = valorMonetarioReservaChinchorro(r);
        sumTotal += total;
        sumSaldo += saldoReservaChinchorro(r);
        sumAbonado += Math.min(montoAbonadoReserva(r), total);
    });

    const filas = listaHab.map(htmlFilaAcomodacionHabitacion).join('') + listaChin.map(htmlFilaAcomodacionChinchorro).join('');
    const totalHuespedes = listaHab.length + listaChin.length;

    panel.innerHTML = `
        <p class="gestion-fecha-consulta muted">Consulta: <strong>${escapeHtmlCal(fechaFmt)}</strong></p>
        <div class="acomodacion-dia-chips">
            <span class="ocupacion-chip chip-total"><span class="chip-label">Alojamientos</span><span class="chip-value">${totalHuespedes}</span></span>
            <span class="ocupacion-chip chip-disponible"><span class="chip-label">Habitaciones</span><span class="chip-value">${listaHab.length}</span></span>
            <span class="ocupacion-chip chip-ocupada"><span class="chip-label">Chinchorros</span><span class="chip-value">${listaChin.length}</span></span>
            <span class="ocupacion-chip chip-porcentaje"><span class="chip-label">Saldo pendiente</span><span class="chip-value">${escapeHtmlCal(formatoMoneda(sumSaldo))}</span></span>
        </div>
        <div class="table-container acomodacion-dia-tabla-wrap">
            <table class="data-table acomodacion-dia-tabla gestion-tabla-acomodacion">
                <thead>
                    <tr>
                        <th>Tipo</th>
                        <th>Recurso</th>
                        <th>Huésped</th>
                        <th>Personas</th>
                        <th>Salida</th>
                        <th>Situación</th>
                        <th>Tarifa</th>
                        <th>Total</th>
                        <th>Abonado</th>
                        <th>Debe</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
                <tfoot>
                    <tr class="acomodacion-dia-total-fila">
                        <td colspan="7"><strong>Total (${totalHuespedes} alojamiento${totalHuespedes === 1 ? '' : 's'})</strong></td>
                        <td><strong>${escapeHtmlCal(formatoMoneda(sumTotal))}</strong></td>
                        <td><strong>${escapeHtmlCal(formatoMoneda(sumAbonado))}</strong></td>
                        <td><strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(sumSaldo))}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function conteoOcupacionHabitacionesEfectiva() {
    const total = habitaciones.length;
    let ocupadas = 0;
    let disponibles = 0;
    let pendientes = 0;
    let otros = 0;
    const hoy = fechaLocalYMD();

    habitaciones.forEach((h) => {
        const est = estadoEfectivoHabitacion(h);
        if (est === 'Ocupada') {
            ocupadas += 1;
            const r = reservas.find(
                (x) =>
                    Number(x.habitacion_id) === Number(h.id) &&
                    reservaPendienteCheckinEnFecha(x, hoy)
            );
            if (r) pendientes += 1;
        } else if (est === 'Disponible') {
            disponibles += 1;
        } else {
            otros += 1;
        }
    });

    return { total, ocupadas, disponibles, pendientes, otros };
}

function renderOcupacionOperativa() {
    const panel = document.getElementById('panelOcupacionOperativa');
    const grid = document.getElementById('gridOcupacionHabitaciones');
    if (!panel || !grid) return;

    const { total, ocupadas, disponibles, pendientes, otros } = conteoOcupacionHabitacionesEfectiva();
    const pctOcup = total > 0 ? Math.round((ocupadas / total) * 100) : 0;
    const wDisp = total > 0 ? (disponibles / total) * 100 : 0;
    const wOcup = total > 0 ? (ocupadas / total) * 100 : 0;
    const hoy = fechaLocalYMD();

    panel.innerHTML = `
        <div class="ocupacion-chips">
            <span class="ocupacion-chip chip-total"><span class="chip-label">Total</span><span class="chip-value">${total}</span></span>
            <span class="ocupacion-chip chip-disponible"><span class="chip-label">Disponibles</span><span class="chip-value">${disponibles}</span></span>
            <span class="ocupacion-chip chip-ocupada"><span class="chip-label">Ocupadas</span><span class="chip-value">${ocupadas}</span></span>
            <span class="ocupacion-chip chip-porcentaje"><span class="chip-label">Ocupación</span><span class="chip-value">${pctOcup}%</span></span>
            ${pendientes ? `<span class="ocupacion-chip chip-pendiente"><span class="chip-label">Pend. check-in</span><span class="chip-value">${pendientes}</span></span>` : ''}
            ${otros ? `<span class="ocupacion-chip chip-otros"><span class="chip-label">No disponibles</span><span class="chip-value">${otros}</span></span>` : ''}
        </div>
        <div class="ocupacion-bar-wrap">
            <div class="ocupacion-bar" role="img" aria-label="${disponibles} disponibles, ${ocupadas} ocupadas">
                ${total ? `<span class="ocupacion-bar-segment bar-disponible" style="width:${wDisp}%"></span>` : ''}
                ${total ? `<span class="ocupacion-bar-segment bar-ocupada" style="width:${wOcup}%"></span>` : ''}
                ${!total ? '<span class="ocupacion-bar-vacio">Sin habitaciones registradas</span>' : ''}
            </div>
        </div>
    `;

    if (!habitaciones.length) {
        grid.innerHTML = '<p class="gestion-vacio">No hay habitaciones registradas.</p>';
        return;
    }

    const ordenadas = [...habitaciones].sort((a, b) => {
        const na = a.numero != null ? Number(a.numero) : Number(a.id);
        const nb = b.numero != null ? Number(b.numero) : Number(b.id);
        return na - nb;
    });

    grid.innerHTML = ordenadas
        .map((h) => {
            const est = estadoEfectivoHabitacion(h);
            const clsEst =
                est === 'Ocupada'
                    ? 'gestion-hab-ocupada'
                    : est === 'Disponible'
                      ? 'gestion-hab-disponible'
                      : 'gestion-hab-otro';
            const occ = resolverOcupacionHabitacion(h);
            const huesped = occ && occ.nombre ? occ.nombre : '';
            const pendiente = reservas.some(
                (r) =>
                    Number(r.habitacion_id) === Number(h.id) &&
                    reservaPendienteCheckinEnFecha(r, hoy)
            );
            const etiqueta = h.numero ? `Hab. ${h.numero}` : h.nombre || `Hab. #${h.id}`;
            const detalle = huesped
                ? `<p class="gestion-hab-huesped">${escapeHtmlCal(huesped)}</p>`
                : pendiente
                  ? '<p class="gestion-hab-huesped gestion-hab-pendiente">Pendiente check-in</p>'
                  : '<p class="gestion-hab-huesped muted">Sin huésped</p>';
            const saldo =
                occ && occ.saldo != null && occ.saldo > 0.005
                    ? `<p class="gestion-hab-saldo">Debe: ${escapeHtmlCal(formatoMoneda(occ.saldo))}</p>`
                    : est === 'Ocupada'
                      ? '<p class="gestion-hab-saldo gestion-hab-saldo--ok">Al día</p>'
                      : '';
            return `
                <article class="gestion-hab-card ${clsEst}">
                    <div class="gestion-hab-card-head">
                        <strong>${escapeHtmlCal(etiqueta)}</strong>
                        <span class="estado-badge ${claseEstadoBadgeRecurso(est)}">${escapeHtmlCal(est)}</span>
                    </div>
                    ${detalle}
                    ${saldo}
                </article>`;
        })
        .join('');
}

function calcularIngresosReservasActivas() {
    const habActivas = reservas.filter((r) => reservaEsActivaOperativa(r));
    const chinActivas = reservasChinchorros.filter((r) => r.estado === 'Activa');
    const hoy = fechaLocalYMD();

    const valorHab = sumarValoresReservas(habActivas, valorMonetarioReservaHabitacion);
    const valorChin = sumarValoresReservas(chinActivas, valorMonetarioReservaChinchorro);
    const abonadoHab = sumarValoresReservas(habActivas, (r) =>
        Math.min(montoAbonadoReserva(r), valorMonetarioReservaHabitacion(r))
    );
    const abonadoChin = sumarValoresReservas(chinActivas, (r) =>
        Math.min(montoAbonadoReserva(r), valorMonetarioReservaChinchorro(r))
    );
    const saldoHab = sumarValoresReservas(habActivas, saldoReservaHabitacion);
    const saldoChin = sumarValoresReservas(chinActivas, saldoReservaChinchorro);

    let ingresoHoyHab = 0;
    let ingresoHoyChin = 0;
    habActivas.forEach((r) => {
        if (reservaOcupadaEnFecha(r, hoy) || reservaPendienteCheckinEnFecha(r, hoy)) {
            ingresoHoyHab += tarifaDiariaReservaHabitacion(r);
        }
    });
    chinActivas.forEach((r) => {
        if (reservaActivaEnFecha(r, hoy)) ingresoHoyChin += tarifaDiariaReservaChinchorro(r);
    });

    return {
        countHab: habActivas.length,
        countChin: chinActivas.length,
        valorTotal: valorHab + valorChin,
        valorHab,
        valorChin,
        abonado: abonadoHab + abonadoChin,
        abonadoHab,
        abonadoChin,
        saldo: saldoHab + saldoChin,
        saldoHab,
        saldoChin,
        ingresoHoy: ingresoHoyHab + ingresoHoyChin,
        ingresoHoyHab,
        ingresoHoyChin
    };
}

function renderIngresosActivasOperativa() {
    const panel = document.getElementById('panelIngresosActivas');
    if (!panel) return;

    const f = calcularIngresosReservasActivas();
    panel.innerHTML = `
        <div class="fin-estado-grid gestion-ingresos-activas-grid">
            ${htmlFinCard('fin-ingresos', 'Valor total (activas)', f.valorTotal, `Hab. ${formatoMoneda(f.valorHab)} (${f.countHab}) · Chin. ${formatoMoneda(f.valorChin)} (${f.countChin})`)}
            ${htmlFinCard('fin-pagado', 'Abonado (activas)', f.abonado, `Hab. ${formatoMoneda(f.abonadoHab)} · Chin. ${formatoMoneda(f.abonadoChin)}`)}
            ${htmlFinCard('fin-adeudado', 'Saldo pendiente (activas)', f.saldo, `Hab. ${formatoMoneda(f.saldoHab)} · Chin. ${formatoMoneda(f.saldoChin)}`)}
            ${htmlFinCard('fin-ingresos', 'Ingreso estimado hoy', f.ingresoHoy, `Tarifa diaria de activas alojadas hoy · Hab. ${formatoMoneda(f.ingresoHoyHab)} · Chin. ${formatoMoneda(f.ingresoHoyChin)}`)}
        </div>
        <p class="fin-estado-nota">
            Estimación basada en reservas <strong>activas</strong> y <strong>pendientes de check-in</strong> (habitaciones).
            El ingreso de hoy corresponde a la tarifa diaria de quienes están alojados o deben ingresar hoy.
        </p>
    `;
}

function reservasConsolidadasTodas() {
    const items = [];
    reservas.forEach((r) => {
        items.push({
            tipo: 'habitacion',
            tipoLabel: 'Habitación',
            id: Number(r.id),
            recurso: etiquetaHabitacionReserva(r),
            huesped: `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || '—',
            personas: `${Number(r.adultos || 1)} / ${Number(r.ninos || 0)}`,
            ingreso: ymdReservaIngreso(r),
            salida: ymdReservaSalida(r),
            estado: r.estado,
            tarifa: Number(r.habitacion_precio_diario) || 0,
            total: valorMonetarioReservaHabitacion(r),
            abonado: Math.min(montoAbonadoReserva(r), valorMonetarioReservaHabitacion(r)),
            saldo: saldoReservaHabitacion(r),
            metodoPago: r.metodo_pago || '—',
            observaciones: r.observaciones || '—',
            fnSaldo: saldoReservaHabitacion,
            claseEstado: claseEstadoReservaHabitacion(r.estado)
        });
    });
    reservasChinchorros.forEach((r) => {
        items.push({
            tipo: 'chinchorro',
            tipoLabel: 'Chinchorro',
            id: Number(r.id),
            recurso: etiquetaChinchorroReserva(r),
            huesped: `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || '—',
            personas: `${Number(r.adultos || 1)} / ${Number(r.ninos || 0)}`,
            ingreso: ymdReservaIngreso(r),
            salida: ymdReservaSalida(r),
            estado: r.estado,
            tarifa: Number(r.chinchorro_precio_diario) || 0,
            total: valorMonetarioReservaChinchorro(r),
            abonado: Math.min(montoAbonadoReserva(r), valorMonetarioReservaChinchorro(r)),
            saldo: saldoReservaChinchorro(r),
            metodoPago: r.metodo_pago || '—',
            observaciones: r.observaciones || '—',
            fnSaldo: saldoReservaChinchorro,
            claseEstado: claseEstadoReservaChinchorro(r.estado)
        });
    });
    items.sort((a, b) => b.id - a.id);
    return items;
}

function reservasConsolidadasFiltradas() {
    const q = (document.getElementById('buscarReservasConsolidado')?.value || '').trim().toLowerCase();
    const estadoFiltro = document.getElementById('filtroEstadoConsolidado')?.value || '';
    const tipoFiltro = document.getElementById('filtroTipoConsolidado')?.value || '';

    return reservasConsolidadasTodas().filter((item) => {
        if (tipoFiltro && item.tipo !== tipoFiltro) return false;
        if (estadoFiltro && item.estado !== estadoFiltro) return false;
        if (!q) return true;
        const blob = [
            item.id,
            item.tipoLabel,
            item.recurso,
            item.huesped,
            item.estado,
            item.metodoPago,
            item.observaciones,
            item.ingreso,
            item.salida
        ]
            .join(' ')
            .toLowerCase();
        return blob.includes(q);
    });
}

function renderListadoConsolidadoReservas() {
    const tbody = document.getElementById('tablaReservasConsolidado');
    if (!tbody) return;

    const lista = reservasConsolidadasFiltradas();
    if (!lista.length) {
        tbody.innerHTML =
            '<tr><td colspan="14" class="gestion-vacio-celda">No hay reservas que coincidan con los filtros actuales.</td></tr>';
        return;
    }

    tbody.innerHTML = lista
        .map((item) => {
            const ingresoFmt = new Date(`${item.ingreso}T12:00:00`).toLocaleDateString('es-ES');
            const salidaFmt = new Date(`${item.salida}T12:00:00`).toLocaleDateString('es-ES');
            const saldoHtml =
                item.saldo > 0.005
                    ? `<strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(item.saldo))}</strong>`
                    : '<span class="muted">—</span>';
            const unidad = item.tipo === 'habitacion' ? '/noche' : '/día';
            return `
                <tr>
                    <td>${item.id}</td>
                    <td>${escapeHtmlCal(item.tipoLabel)}</td>
                    <td><strong>${escapeHtmlCal(item.recurso)}</strong></td>
                    <td>${escapeHtmlCal(item.huesped)}</td>
                    <td>${escapeHtmlCal(item.personas)}</td>
                    <td>${escapeHtmlCal(ingresoFmt)}</td>
                    <td>${escapeHtmlCal(salidaFmt)}</td>
                    <td><span class="estado-badge ${item.claseEstado}">${escapeHtmlCal(item.estado)}</span></td>
                    <td>${escapeHtmlCal(formatoMoneda(item.tarifa))} <span class="muted">${unidad}</span></td>
                    <td><strong>${escapeHtmlCal(formatoMoneda(item.total))}</strong></td>
                    <td>${escapeHtmlCal(formatoMoneda(item.abonado))}</td>
                    <td>${saldoHtml}</td>
                    <td>${escapeHtmlCal(item.metodoPago)}</td>
                    <td class="gestion-obs-celda">${escapeHtmlCal(item.observaciones)}</td>
                </tr>`;
        })
        .join('');
}

function renderGestionOperativa() {
    renderAcomodacionOperativa();
    renderOcupacionOperativa();
    renderIngresosActivasOperativa();
    renderDashboardKpis();
    renderIngresosPorRecursoMes();
    renderIndicadoresFinanciero();
    renderListadoConsolidadoReservas();
    refrescarPanelesOcupacionDual();
}

async function refrescarGestionOperativa() {
    await Promise.all([
        cargarHabitaciones(),
        cargarChinchorros(),
        cargarHuespedes(),
        cargarReservas(),
        cargarReservasChinchorros()
    ]);
    inicializarGestionOperativa();
    renderGestionOperativa();
}

async function actualizarIndicadoresOcupacion() {
    await refrescarGestionOperativa();
}

function descartarBannerSalidasHoy() {
    sessionStorage.setItem(`bannerSalidasDescartado_${fechaLocalYMD()}`, '1');
    const banner = document.getElementById('bannerSalidasHoy');
    if (banner) {
        banner.hidden = true;
        banner.innerHTML = '';
    }
}

function actualizarAlertasSalidasHoy() {
    const hoy = fechaLocalYMD();
    if (sessionStorage.getItem(`bannerSalidasDescartado_${hoy}`)) {
        return;
    }
    const salidasHab = reservas.filter(
        (r) => r.estado === 'Activa' && String(r.fecha_salida).slice(0, 10) === hoy
    );
    const salidasChin = reservasChinchorros.filter(
        (r) => r.estado === 'Activa' && String(r.fecha_salida).slice(0, 10) === hoy
    );
    const banner = document.getElementById('bannerSalidasHoy');
    if (!banner) {
        return;
    }
    if (salidasHab.length === 0 && salidasChin.length === 0) {
        banner.hidden = true;
        banner.innerHTML = '';
        return;
    }

    let html = `<div style="overflow:hidden"><strong>🔔 Salidas previstas para hoy (${new Date().toLocaleDateString('es-ES')})</strong>`;
    html += `<button type="button" class="btn-secondary btn-small" style="float:right" onclick="descartarBannerSalidasHoy()">Ocultar hoy</button></div>`;
    html += `<span class="muted" style="display:block;margin:8px 0">Actualice el estado: si el huésped <strong>sale</strong>, finalice para liberar; si <strong>se queda</strong>, extienda las fechas en la reserva.</span>`;

    salidasHab.forEach((r) => {
        const nombre = `${escapeHtmlCal(r.huesped_nombre)} ${escapeHtmlCal(r.huesped_apellido || '')}`.trim();
        html += `<div class="banner-salidas-linea"><span><strong>Habitación ${escapeHtmlCal(r.habitacion_numero)}</strong> · ${nombre}</span>`;
        html += `<button type="button" class="btn-primary btn-small" onclick="finalizarReservaSalida(${r.id})">✓ Salió — finalizar</button>`;
        html += `<button type="button" class="btn-secondary btn-small" onclick="modificarReserva(${r.id})">📅 Se queda — extender</button></div>`;
    });
    salidasChin.forEach((r) => {
        const nombre = `${escapeHtmlCal(r.huesped_nombre)} ${escapeHtmlCal(r.huesped_apellido || '')}`.trim();
        html += `<div class="banner-salidas-linea"><span><strong>Chinchorro ${escapeHtmlCal(r.chinchorro_codigo)}</strong> · ${nombre}</span>`;
        html += `<button type="button" class="btn-primary btn-small" onclick="finalizarReservaChinchorroSalida(${r.id})">✓ Devolvió — finalizar</button>`;
        html += `<button type="button" class="btn-secondary btn-small" onclick="modificarReservaChinchorro(${r.id})">📅 Se queda — extender</button></div>`;
    });
    banner.innerHTML = html;
    banner.hidden = false;

    const nk = `notifySalidas_${hoy}`;
    if (!sessionStorage.getItem(nk) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            const n = salidasHab.length + salidasChin.length;
            new Notification('Salidas previstas hoy', {
                body: `Tiene ${n} reserva(s) con salida hoy.`,
                tag: 'salidas-hotel'
            });
        } catch (_) { /* ignore */ }
        sessionStorage.setItem(nk, '1');
    }
}

// Verificar autenticación al cargar
async function verificarAutenticacion() {
    try {
        const response = await fetch(`${API_URL}/auth/check`, {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (!data.authenticated) {
            if (data.error === 'Cuenta desactivada' || data.error === 'Cuenta anulada') {
                sessionStorage.setItem('loginAviso', data.error);
            }
            window.location.href = '/login.html';
            return false;
        }
        
        usuarioActual = data.user;
        normalizarRolSesion();
        aplicarPermisosUI();
        return true;
    } catch (error) {
        console.error('Error al verificar autenticación:', error);
        window.location.href = '/login.html';
        return false;
    }
}

/** Normaliza rol en cliente (sesiones antiguas o filas sin columna rol en BD). */
function normalizarRolSesion() {
    if (!usuarioActual) return;
    const r = String(usuarioActual.rol || '').trim().toLowerCase();
    if (r === 'administrador') {
        usuarioActual.rol = 'administrador';
        return;
    }
    if (usuarioActual.username && String(usuarioActual.username).trim().toLowerCase() === 'admin') {
        usuarioActual.rol = 'administrador';
        return;
    }
    usuarioActual.rol = 'operador';
}

function usuarioEsAdministrador() {
    if (!usuarioActual) return false;
    return String(usuarioActual.rol || '').trim().toLowerCase() === 'administrador';
}

function aplicarPermisosUI() {
    const esAdmin = usuarioEsAdministrador();
    document.querySelectorAll('.solo-admin').forEach((el) => {
        if (esAdmin) {
            el.classList.remove('oculto-sin-permiso');
        } else {
            el.classList.add('oculto-sin-permiso');
        }
    });
    const rolBanner = document.getElementById('configRolActual');
    if (rolBanner && usuarioActual) {
        const rolTxt = esAdmin ? 'Administrador' : 'Operador';
        rolBanner.textContent =
            `Sesión activa: «${usuarioActual.username}» · Rol: ${rolTxt}. ` +
            (esAdmin
                ? 'Puede gestionar usuarios, la paleta de colores y el resto de opciones de administrador.'
                : 'Solo verá el resumen de permisos; la gestión de cuentas y los colores los define un administrador.');
        rolBanner.style.display = 'block';
    }
    const banner = document.getElementById('adminUsuarioActual');
    if (banner && usuarioActual) {
        banner.textContent = `Área de administración de credenciales (solo administradores).`;
        banner.style.display = esAdmin ? 'block' : 'none';
    }
}

// Interceptor para manejar errores 401
async function fetchWithAuth(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: 'include'
    });
    
    if (response.status === 401) {
        window.location.href = '/login.html';
        throw new Error('No autorizado');
    }
    if (response.status === 403) {
        let msg = 'No tiene permisos para esta acción';
        try {
            const d = await response.json();
            if (d.error) msg = d.error;
        } catch (_) { /* ignore */ }
        alert(msg);
        throw new Error('Forbidden');
    }

    return response;
}

// Función de logout
async function cerrarSesion() {
    if (!confirm('¿Está seguro de que desea cerrar sesión?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            window.location.href = '/login.html';
        } else {
            alert('Error al cerrar sesión');
        }
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        // Redirigir de todas formas
        window.location.href = '/login.html';
    }
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    // Verificar autenticación primero
    const autenticado = await verificarAutenticacion();
    if (!autenticado) {
        return;
    }
    
    // Si está autenticado, sincronizar estados con reservas y cargar datos
    cargarNombreHotel();
    await sincronizarEstadosInventarioConReservas();
    cargarHabitaciones();
    cargarChinchorros();
    cargarHuespedes();
    cargarReservas();
    cargarReservasChinchorros();
    
    // Establecer fecha mínima para las fechas de reserva (modal habitación)
    const fechaIngresoInput = document.getElementById('fechaIngreso');
    const fechaSalidaInput = document.getElementById('fechaSalida');
    aplicarFechasMinNuevaReservaHabitacion();
    
    // Actualizar fecha mínima de salida cuando cambia la de ingreso
    if (fechaIngresoInput) {
        fechaIngresoInput.addEventListener('change', (e) => {
            const fechaIngreso = e.target.value;
            if (fechaSalidaInput) {
                fechaSalidaInput.min = fechaIngreso;
            }
        });
    }

    const hoyLocal = fechaLocalYMD();

    const fechaIngresoChin = document.getElementById('fechaIngresoChin');
    const fechaSalidaChin = document.getElementById('fechaSalidaChin');
    if (fechaIngresoChin) {
        fechaIngresoChin.min = hoyLocal;
    }
    if (fechaSalidaChin) {
        fechaSalidaChin.min = hoyLocal;
    }
    if (fechaIngresoChin) {
        fechaIngresoChin.addEventListener('change', (e) => {
            const v = e.target.value;
            if (fechaSalidaChin) {
                fechaSalidaChin.min = v;
            }
        });
    }

    initComboboxesHuespedReserva();
    enlazarEventosCalendarioReserva();

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
    actualizarAlertasSalidasHoy();
    setInterval(actualizarAlertasSalidasHoy, 60000);

    const inputArchivoFondo = document.getElementById('temaFondoArchivo');
    const nombreArchivoFondo = document.getElementById('temaFondoArchivoNombre');
    if (inputArchivoFondo && nombreArchivoFondo) {
        inputArchivoFondo.addEventListener('change', () => {
            const archivo = inputArchivoFondo.files && inputArchivoFondo.files[0];
            nombreArchivoFondo.textContent = archivo ? `Seleccionado: ${archivo.name}` : 'Ningún archivo seleccionado';
        });
    }
    const inputArchivoLogo = document.getElementById('temaLogoArchivo');
    const nombreArchivoLogo = document.getElementById('temaLogoArchivoNombre');
    if (inputArchivoLogo && nombreArchivoLogo) {
        inputArchivoLogo.addEventListener('change', () => {
            const archivo = inputArchivoLogo.files && inputArchivoLogo.files[0];
            nombreArchivoLogo.textContent = archivo ? `Seleccionado: ${archivo.name}` : 'Ningún archivo seleccionado';
        });
    }
});

// ========== FUNCIONES DE NAVEGACIÓN ==========
function mostrarSeccion(seccion, boton) {
    document.querySelectorAll('.seccion').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`seccion-${seccion}`).classList.add('active');
    if (boton) {
        boton.classList.add('active');
    }
    if (seccion === 'reservas') {
        renderModuloReservas();
    }
    if (seccion === 'gestion-operativa') {
        inicializarGestionOperativa();
        refrescarGestionOperativa();
    }
    if (seccion === 'calendario') {
        actualizarCalendarioDisponibilidad();
    }
    if (seccion === 'configuracion') {
        aplicarPermisosUI();
        if (usuarioEsAdministrador()) {
            cargarUsuariosAdmin();
        }
        if (datosHotelCache) {
            rellenarCamposTemaDesdeHotel(datosHotelCache);
            sincronizarSelectsYResumenVistas();
        } else {
            cargarNombreHotel();
        }
    }
}

// ========== CALENDARIO DE DISPONIBILIDAD ==========
const DIAS_SEMANA_CAL = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];
const NOMBRES_MES_CAL = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

function ymdLocalDesdeDate(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function listaDiasMesCal(year, monthIdx) {
    const ultimo = new Date(year, monthIdx + 1, 0).getDate();
    const out = [];
    for (let d = 1; d <= ultimo; d++) {
        const dt = new Date(year, monthIdx, d);
        out.push({ ymd: ymdLocalDesdeDate(dt), date: dt, dayNum: d });
    }
    return out;
}

function sumarDiasYMD(ymd, dias) {
    const p = String(ymd).slice(0, 10).split('-').map(Number);
    if (p.length < 3) return ymd;
    const dt = new Date(p[0], p[1] - 1, p[2]);
    dt.setDate(dt.getDate() + (Number(dias) || 0));
    return ymdLocalDesdeDate(dt);
}

/** Fechas sugeridas al reservar desde el calendario (ingreso + 1 noche/día). */
let calendarioReservaPendiente = null;

function tipoRecursoDesdeWrapCalendario(wrapEl) {
    if (!wrapEl) return 'habitacion';
    return wrapEl.id === 'calendarioChinchorrosWrap' ? 'chinchorro' : 'habitacion';
}

function reservaEnCeldaCalendarioLista(recursoId, ymd, listaReservas, idCampo) {
    return listaReservas.find((r) => {
        if (!reservaBloqueaHabitacion(r) || reservaEsNoShow(r)) return false;
        if (Number(r[idCampo]) !== Number(recursoId)) return false;
        const ing = String(r.fecha_ingreso).slice(0, 10);
        const sal = String(r.fecha_salida).slice(0, 10);
        if (ymd < ing || ymd > sal) return false;
        if (reservaPendienteCheckin(r)) return ymd === ing;
        if (reservaEstaConCheckin(r)) return true;
        if (String(r.estado) === 'Activa' && !r.checkin_at) return ymd < ing;
        return false;
    });
}

function clasificarCeldaCalendarioReserva(r, ymd) {
    if (!r || reservaEsNoShow(r)) return 'libre';
    const ing = ymdReservaIngreso(r);
    const sal = ymdReservaSalida(r);
    if (!ymdEnRangoReserva(ymd, ing, sal)) return 'libre';
    if (reservaPendienteCheckinEnFecha(r, ymd)) return 'pendiente-checkin';
    if (reservaOcupadaEnFecha(r, ymd)) return 'ocupado';
    if (String(r.estado) === 'Activa' && !r.checkin_at && ymd < ing) return 'reservado-futuro';
    return 'libre';
}

function textoHuespedReservaCalendario(r) {
    if (!r) return '';
    return `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || 'Huésped';
}

function reservaActivaEnCeldaCalendario(recursoId, ymd, tipo) {
    const lista = tipo === 'chinchorro' ? reservasChinchorros : reservas;
    const campo = tipo === 'chinchorro' ? 'chinchorro_id' : 'habitacion_id';
    return reservaEnCeldaCalendarioLista(recursoId, ymd, lista, campo);
}

function diaOcupadoPorReservaActiva(recursoId, ymd, listaReservas, idCampo) {
    const r = reservaEnCeldaCalendarioLista(recursoId, ymd, listaReservas, idCampo);
    return clasificarCeldaCalendarioReserva(r, ymd) === 'ocupado';
}

function escapeHtmlCal(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

function attrEsc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function construirTablaCalendario(esquinaLabel, filas, dias, idCampo, listaReservas) {
    if (!filas.length) {
        return '<p class="cal-sin-datos">No hay registros. Crea habitaciones o chinchorros primero.</p>';
    }
    let headNums = `<tr><th class="cal-corner">${esquinaLabel}</th>`;
    let headDow = '<tr><th class="cal-corner"></th>';
    dias.forEach(({ ymd, date, dayNum }) => {
        const tituloDia = attrEsc(`Reservar desde ${ymd}`);
        headNums += `<th class="cal-dia-num cal-dia-click" scope="col" data-ymd="${ymd}" title="${tituloDia}" role="button" tabindex="0">${dayNum}</th>`;
        headDow += `<th class="cal-dia-dow cal-dia-click" scope="col" data-ymd="${ymd}" title="${tituloDia}" role="button" tabindex="0">${DIAS_SEMANA_CAL[date.getDay()]}</th>`;
    });
    headNums += '</tr>';
    headDow += '</tr>';

    let body = '';
    filas.forEach((f) => {
        body += `<tr><th class="cal-recurso" scope="row">${escapeHtmlCal(f.label)}</th>`;
        dias.forEach(({ ymd }) => {
            const reservaCelda = reservaEnCeldaCalendarioLista(f.id, ymd, listaReservas, idCampo);
            const tipoCelda = clasificarCeldaCalendarioReserva(reservaCelda, ymd);
            const ocupado = tipoCelda === 'ocupado';
            const pendienteCheckin = tipoCelda === 'pendiente-checkin';
            const bloqueado = !!f.noReservable;
            let cls;
            let estadoTxt;
            let inner;
            let huespedNombre = '';
            if (ocupado || pendienteCheckin) {
                huespedNombre = textoHuespedReservaCalendario(reservaCelda);
            }
            if (ocupado) {
                cls = 'cal-ocupado';
                estadoTxt = huespedNombre
                    ? `Ocupado por ${huespedNombre} — clic para ver reserva`
                    : 'Ocupado (clic para ver reserva)';
                inner = '●';
            } else if (pendienteCheckin) {
                cls = 'cal-pendiente-checkin';
                estadoTxt = huespedNombre
                    ? `Pendiente de check-in: ${huespedNombre}`
                    : 'Pendiente de check-in';
                inner = '⏳';
            } else if (bloqueado) {
                cls = 'cal-no-reservable';
                estadoTxt = 'En limpieza o fuera de servicio — no reservable';
                inner = '—';
            } else {
                cls = 'cal-libre';
                estadoTxt = 'Disponible (clic para reservar)';
                inner = '+';
            }
            const tituloCelda = attrEsc(`${f.label} · ${ymd} · ${estadoTxt}`);
            const huespedAttr = huespedNombre ? ` data-huesped="${attrEsc(huespedNombre)}"` : '';
            body += `<td class="cal-cell cal-cell-click ${cls}" data-recurso-id="${f.id}" data-ymd="${ymd}" data-ocupado="${ocupado ? '1' : '0'}" data-pendiente-checkin="${pendienteCheckin ? '1' : '0'}" data-bloqueado="${bloqueado ? '1' : '0'}"${huespedAttr} title="${tituloCelda}" role="button" tabindex="0" aria-label="${tituloCelda}"><span class="cal-cell-inner">${inner}</span></td>`;
        });
        body += '</tr>';
    });

    return `<table class="cal-tabla"><thead>${headNums}${headDow}</thead><tbody>${body}</tbody></table>`;
}

function renderCalendarioDisponibilidad() {
    const wrapH = document.getElementById('calendarioHabitacionesWrap');
    const wrapC = document.getElementById('calendarioChinchorrosWrap');
    const titulo = document.getElementById('calendarioTituloMes');
    if (!wrapH || !wrapC || !titulo) return;

    const { y, m } = calendarioMesVista;
    titulo.textContent = `${NOMBRES_MES_CAL[m]} ${y}`;

    const dias = listaDiasMesCal(y, m);
    const filasHab = habitaciones.map((h) => ({
        id: h.id,
        label: etiquetaHabitacion(h),
        noReservable: !inventarioPermiteNuevaReserva(h.estado)
    }));
    const filasCh = chinchorros.map((c) => ({
        id: c.id,
        label: etiquetaChinchorro(c),
        noReservable: !inventarioPermiteNuevaReserva(c.estado)
    }));

    wrapH.innerHTML = construirTablaCalendario('Habitación', filasHab, dias, 'habitacion_id', reservas);
    wrapC.innerHTML = construirTablaCalendario('Chinchorro', filasCh, dias, 'chinchorro_id', reservasChinchorros);
}

function fechasReservaDesdeCalendario(ymdClic) {
    const hoy = fechaLocalYMD();
    const ingreso = String(ymdClic).slice(0, 10) < hoy ? hoy : String(ymdClic).slice(0, 10);
    const salida = sumarDiasYMD(ingreso, 1);
    return { ingreso, salida };
}

async function abrirReservaHabitacionDesdeCalendario(habitacionId, ymdClic) {
    if (habitacionId != null) {
        const hab = habitaciones.find((x) => Number(x.id) === Number(habitacionId));
        if (hab && !inventarioPermiteNuevaReserva(hab.estado)) {
            alert(mensajeInventarioNoReservableUI(hab.estado, 'habitacion'));
            return;
        }
    }
    const { ingreso, salida } = fechasReservaDesdeCalendario(ymdClic);
    await asegurarHuespedesParaReserva();
    document.getElementById('formReserva').reset();
    document.getElementById('idReservaEdicion').value = '';
    document.getElementById('tituloModalReserva').textContent = 'Nueva reserva (desde calendario)';
    document.getElementById('reservaAdultos').value = '1';
    document.getElementById('reservaNinos').value = '0';
    document.getElementById('metodoPagoReserva').value = 'Efectivo';
    document.getElementById('tarifaNocheReserva').value = '0';
    document.getElementById('abonoInicialReserva').value = '';
    document.getElementById('observacionesReserva').value = '';
    establecerModoModalReserva(false);
    limpiarComboboxHuesped('huespedReserva');
    actualizarSelectsReserva();
    if (habitacionId != null) {
        const hab = habitaciones.find((x) => Number(x.id) === Number(habitacionId));
        const selHab = document.getElementById('habitacionReserva');
        asegurarOpcionEnSelect(selHab, habitacionId, hab ? etiquetaHabitacion(hab) : undefined);
    }
    document.getElementById('fechaIngreso').value = ingreso;
    document.getElementById('fechaSalida').value = salida;
    aplicarFechasMinNuevaReservaHabitacion();
    const fs = document.getElementById('fechaSalida');
    if (fs) fs.min = ingreso;
    document.getElementById('modalReserva').classList.add('active');
}

async function abrirReservaChinchorroDesdeCalendario(chinchorroId, ymdClic) {
    if (chinchorroId != null) {
        const ch = chinchorros.find((x) => Number(x.id) === Number(chinchorroId));
        if (ch && !inventarioPermiteNuevaReserva(ch.estado)) {
            alert(mensajeInventarioNoReservableUI(ch.estado, 'chinchorro'));
            return;
        }
    }
    const { ingreso, salida } = fechasReservaDesdeCalendario(ymdClic);
    await asegurarHuespedesParaReserva();
    document.getElementById('formReservaChinchorro').reset();
    document.getElementById('idReservaChinchorroEdicion').value = '';
    const titulo = document.getElementById('tituloModalReservaChin');
    if (titulo) titulo.textContent = 'Nueva reserva (desde calendario)';
    document.getElementById('reservaChinAdultos').value = '1';
    document.getElementById('reservaChinNinos').value = '0';
    document.getElementById('metodoPagoReservaChin').value = 'Efectivo';
    document.getElementById('tarifaDiaReservaChin').value = '0';
    document.getElementById('abonoInicialReservaChin').value = '';
    document.getElementById('observacionesReservaChin').value = '';
    establecerModoModalReservaChin(false);
    limpiarComboboxHuesped('huespedReservaChin');
    actualizarSelectsReservaChinchorro();
    if (chinchorroId != null) {
        const ch = chinchorros.find((x) => Number(x.id) === Number(chinchorroId));
        const sel = document.getElementById('chinchorroReserva');
        if (sel && ch) {
            asegurarOpcionEnSelect(sel, chinchorroId, etiquetaChinchorro(ch));
        }
    }
    const fi = document.getElementById('fechaIngresoChin');
    const fs = document.getElementById('fechaSalidaChin');
    const hoy = fechaLocalYMD();
    if (fi) {
        fi.min = hoy;
        fi.value = ingreso;
    }
    if (fs) {
        fs.min = ingreso;
        fs.value = salida;
    }
    document.getElementById('modalReservaChinchorro').classList.add('active');
}

function abrirElegirTipoReservaDesdeCalendario(ymdClic, tipoForzado) {
    const { ingreso, salida } = fechasReservaDesdeCalendario(ymdClic);
    calendarioReservaPendiente = { ingreso, salida, recursoId: null };
    if (tipoForzado === 'habitacion') {
        abrirReservaHabitacionDesdeCalendario(null, ingreso);
        return;
    }
    if (tipoForzado === 'chinchorro') {
        abrirReservaChinchorroDesdeCalendario(null, ingreso);
        return;
    }
    mostrarModalElegirTipoReserva();
}

async function onClickCalendarioCelda(ev) {
    const wrap = ev.currentTarget;
    const tipo = tipoRecursoDesdeWrapCalendario(wrap);

    const thDia = ev.target.closest('.cal-dia-click');
    if (thDia && thDia.dataset.ymd) {
        abrirElegirTipoReservaDesdeCalendario(thDia.dataset.ymd, tipo);
        return;
    }

    const td = ev.target.closest('.cal-cell-click');
    if (!td || !td.dataset.ymd) return;

    const ymd = td.dataset.ymd;
    const recursoId = parseInt(td.dataset.recursoId, 10);
    const ocupado = td.dataset.ocupado === '1';
    const bloqueado = td.dataset.bloqueado === '1';

    if (!ocupado && bloqueado) {
        const rec = recursoInventarioPorTipoId(tipo, recursoId);
        alert(mensajeInventarioNoReservableUI(rec && rec.estado, tipo));
        return;
    }

    const pendienteCheckin = td.dataset.pendienteCheckin === '1';
    if (pendienteCheckin && tipo === 'habitacion') {
        const lista = reservas;
        const r = reservaEnCeldaCalendarioLista(recursoId, ymd, lista, 'habitacion_id');
        if (r) {
            await confirmarCheckinReserva(r.id);
        }
        return;
    }

    if (ocupado) {
        const lista = tipo === 'chinchorro' ? reservasChinchorros : reservas;
        const campo = tipo === 'chinchorro' ? 'chinchorro_id' : 'habitacion_id';
        const r = reservaEnCeldaCalendarioLista(recursoId, ymd, lista, campo);
        if (r) {
            const ver = confirm(
                'Este día ya tiene una reserva activa.\n\n¿Desea abrir esa reserva para modificarla?'
            );
            if (ver) {
                if (tipo === 'chinchorro') {
                    await modificarReservaChinchorro(r.id);
                } else {
                    await modificarReserva(r.id);
                }
            }
        } else {
            alert('Este día está marcado como ocupado.');
        }
        return;
    }

    if (tipo === 'chinchorro') {
        await abrirReservaChinchorroDesdeCalendario(recursoId, ymd);
    } else {
        await abrirReservaHabitacionDesdeCalendario(recursoId, ymd);
    }
}

function enlazarEventosCalendarioReserva() {
    if (window.__calReservaEventosOk) return;
    window.__calReservaEventosOk = true;
    ['calendarioHabitacionesWrap', 'calendarioChinchorrosWrap'].forEach((id) => {
        const wrap = document.getElementById(id);
        if (!wrap) return;
        wrap.addEventListener('click', onClickCalendarioCelda);
        wrap.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            const el = ev.target.closest('.cal-cell-click, .cal-dia-click');
            if (!el) return;
            ev.preventDefault();
            el.click();
        });
    });
}

/** Recalcula Ocupada / Reservada / Disponible según reservas activas en el servidor. */
async function sincronizarEstadosInventarioConReservas() {
    try {
        await fetchWithAuth(`${API_URL}/inventario/sincronizar-estados`, { method: 'POST' });
    } catch (e) {
        console.warn('No se pudo sincronizar estados del inventario:', e);
    }
}

async function actualizarCalendarioDisponibilidad() {
    try {
        await Promise.all([
            cargarReservas(),
            cargarReservasChinchorros(),
            cargarHabitaciones(),
            cargarChinchorros()
        ]);
        renderCalendarioDisponibilidad();
    } catch (e) {
        console.error('Error al actualizar calendario:', e);
    }
}

function calendarioMesAnterior() {
    calendarioMesVista.m -= 1;
    if (calendarioMesVista.m < 0) {
        calendarioMesVista.m = 11;
        calendarioMesVista.y -= 1;
    }
    renderCalendarioDisponibilidad();
}

function calendarioMesSiguiente() {
    calendarioMesVista.m += 1;
    if (calendarioMesVista.m > 11) {
        calendarioMesVista.m = 0;
        calendarioMesVista.y += 1;
    }
    renderCalendarioDisponibilidad();
}

function rellenarCamposTemaDesdeHotel(data) {
    if (!data || typeof TemaHotel === 'undefined') return;
    const elP = document.getElementById('temaColorPrimario');
    if (!elP) return;
    const d = TemaHotel.DEF;
    elP.value = TemaHotel.hexNormalizado(data.color_primario) || d.color_primario;
    document.getElementById('temaColorSecundario').value =
        TemaHotel.hexNormalizado(data.color_secundario) || d.color_secundario;
    document.getElementById('temaColorAcento').value =
        TemaHotel.hexNormalizado(data.color_acento) || d.color_acento;
    document.getElementById('temaColorTitulo').value =
        TemaHotel.hexNormalizado(data.color_titulo) || d.color_titulo;
    const elFondo = document.getElementById('temaFondoImagenUrl');
    if (elFondo) {
        elFondo.value = data && data.fondo_imagen_url ? String(data.fondo_imagen_url) : '';
    }
    const elLogo = document.getElementById('temaLogoUrl');
    if (elLogo) {
        elLogo.value = data && data.logo_url ? String(data.logo_url) : '';
    }
    if (typeof TemaHotel !== 'undefined' && TemaHotel.aplicarLogo) {
        TemaHotel.aplicarLogo(document, data);
    }
    rellenarCamposFacturacionDian(data);
}

function datosFacturacionDianDesdeFormulario() {
    return {
        nit: document.getElementById('hotelNit')?.value.trim() || '',
        nit_dv: document.getElementById('hotelNitDv')?.value.trim() || '',
        razon_social: document.getElementById('hotelRazonSocial')?.value.trim() || '',
        dian_resolucion: document.getElementById('hotelDianResolucion')?.value.trim() || '',
        dian_resolucion_fecha: document.getElementById('hotelDianResolucionFecha')?.value || '',
        dian_prefijo: document.getElementById('hotelDianPrefijo')?.value.trim().toUpperCase() || '',
        dian_rango_desde: document.getElementById('hotelDianRangoDesde')?.value || '',
        dian_rango_hasta: document.getElementById('hotelDianRangoHasta')?.value || '',
        dian_vigencia_desde: document.getElementById('hotelDianVigenciaDesde')?.value || '',
        dian_vigencia_hasta: document.getElementById('hotelDianVigenciaHasta')?.value || '',
        dian_clave_tecnica: document.getElementById('hotelDianClaveTecnica')?.value.trim() || '',
        dian_envio_automatico: document.getElementById('hotelDianEnvioAutomatico')?.checked ? 1 : 0
    };
}

function hotelTieneResolucionDianCliente(hotel) {
    const h = hotel || {};
    const desde = parseInt(h.dian_rango_desde, 10);
    const hasta = parseInt(h.dian_rango_hasta, 10);
    return !!(
        String(h.nit || '').trim() &&
        String(h.dian_resolucion || '').trim() &&
        String(h.dian_prefijo || '').trim() &&
        String(h.dian_clave_tecnica || '').trim() &&
        Number.isFinite(desde) &&
        Number.isFinite(hasta) &&
        hasta >= desde
    );
}

function actualizarEstadoResolucionDianUi(hotel) {
    const el = document.getElementById('estadoResolucionDian');
    if (!el) return;
    if (hotelTieneResolucionDianCliente(hotel)) {
        const pref = String(hotel.dian_prefijo || '').toUpperCase();
        const modo = dianEnvioAutomaticoActivo(hotel)
            ? 'Envío automático al imprimir'
            : 'Envío manual con botón 📤 DIAN';
        el.textContent = `Resolución lista: ${hotel.dian_resolucion} · Prefijo ${pref} · Rango ${hotel.dian_rango_desde} - ${hotel.dian_rango_hasta} · ${modo}`;
        el.classList.remove('texto-error');
    } else {
        el.textContent =
            'Complete NIT, número de resolución, prefijo, rango (desde/hasta) y clave técnica para habilitar el envío a la DIAN.';
        el.classList.add('texto-error');
    }
}

function rellenarCamposFacturacionDian(data) {
    const d = data || {};
    const elNit = document.getElementById('hotelNit');
    if (!elNit) return;
    elNit.value = d.nit ? String(d.nit) : '';
    const elDv = document.getElementById('hotelNitDv');
    if (elDv) elDv.value = d.nit_dv ? String(d.nit_dv) : '';
    const elRazon = document.getElementById('hotelRazonSocial');
    if (elRazon) elRazon.value = d.razon_social ? String(d.razon_social) : '';
    const elRes = document.getElementById('hotelDianResolucion');
    if (elRes) elRes.value = d.dian_resolucion ? String(d.dian_resolucion) : '';
    const elResF = document.getElementById('hotelDianResolucionFecha');
    if (elResF) elResF.value = d.dian_resolucion_fecha ? String(d.dian_resolucion_fecha).slice(0, 10) : '';
    const elPref = document.getElementById('hotelDianPrefijo');
    if (elPref) elPref.value = d.dian_prefijo ? String(d.dian_prefijo) : '';
    const elDesde = document.getElementById('hotelDianRangoDesde');
    if (elDesde) elDesde.value = d.dian_rango_desde != null ? String(d.dian_rango_desde) : '';
    const elHasta = document.getElementById('hotelDianRangoHasta');
    if (elHasta) elHasta.value = d.dian_rango_hasta != null ? String(d.dian_rango_hasta) : '';
    const elVigD = document.getElementById('hotelDianVigenciaDesde');
    if (elVigD) elVigD.value = d.dian_vigencia_desde ? String(d.dian_vigencia_desde).slice(0, 10) : '';
    const elVigH = document.getElementById('hotelDianVigenciaHasta');
    if (elVigH) elVigH.value = d.dian_vigencia_hasta ? String(d.dian_vigencia_hasta).slice(0, 10) : '';
    const elClave = document.getElementById('hotelDianClaveTecnica');
    if (elClave) elClave.value = d.dian_clave_tecnica ? String(d.dian_clave_tecnica) : '';
    const elAuto = document.getElementById('hotelDianEnvioAutomatico');
    if (elAuto) elAuto.checked = dianEnvioAutomaticoActivo(d);
    actualizarEstadoResolucionDianUi(d);
}

async function guardarFacturacionDian() {
    const payload = datosFacturacionDianDesdeFormulario();
    if (!payload.nit) {
        alert('El NIT del establecimiento es obligatorio.');
        return;
    }
    if (!payload.dian_resolucion) {
        alert('El número de resolución DIAN es obligatorio.');
        return;
    }
    if (!payload.dian_prefijo) {
        alert('El prefijo de facturación es obligatorio.');
        return;
    }
    if (!payload.dian_clave_tecnica) {
        alert('La clave técnica DIAN es obligatoria.');
        return;
    }
    const desde = parseInt(payload.dian_rango_desde, 10);
    const hasta = parseInt(payload.dian_rango_hasta, 10);
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde < 1 || hasta < desde) {
        alert('El rango autorizado (desde / hasta) no es válido.');
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel/facturacion`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(data.error || 'No se pudo guardar la resolución DIAN.');
            return;
        }
        datosHotelCache = { ...(datosHotelCache || {}), ...payload };
        actualizarEstadoResolucionDianUi(datosHotelCache);
        await Promise.all([cargarReservas(), cargarReservasChinchorros()]);
        alert('Resolución y datos de facturación DIAN guardados correctamente.');
    } catch (e) {
        console.error(e);
        alert('Error de conexión al guardar la resolución DIAN.');
    }
}

function abrirSelectorLogoArchivo() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede subir el logotipo.');
        return;
    }
    const input = document.getElementById('temaLogoArchivo');
    if (input) {
        input.click();
    }
}

async function subirLogoArchivoSeleccionado() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede subir el logotipo.');
        return;
    }
    const input = document.getElementById('temaLogoArchivo');
    if (!input || !input.files || input.files.length === 0) {
        alert('Primero seleccione una imagen.');
        return;
    }
    const archivo = input.files[0];
    const formData = new FormData();
    formData.append('logo', archivo);
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel/logo-upload`, {
            method: 'POST',
            body: formData
        });
        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            const url = data && data.logo_url ? String(data.logo_url) : '';
            if (url) {
                const elLogo = document.getElementById('temaLogoUrl');
                if (elLogo) {
                    elLogo.value = url;
                }
            }
            const inputLogo = document.getElementById('temaLogoArchivo');
            if (inputLogo) {
                inputLogo.value = '';
            }
            const nombreArchivoLogo = document.getElementById('temaLogoArchivoNombre');
            if (nombreArchivoLogo) {
                nombreArchivoLogo.textContent = 'Ningún archivo seleccionado';
            }
            await cargarNombreHotel();
            alert('Logotipo subido y aplicado correctamente.');
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo subir el logotipo.');
            alert(msg);
        }
    } catch (error) {
        if (error && error.message === 'Forbidden') return;
        alert('Error al subir el logotipo.');
        console.error(error);
    }
}

async function quitarLogoHotel() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede quitar el logotipo.');
        return;
    }
    if (!confirm('¿Quitar el logotipo personalizado y volver al ícono predeterminado?')) {
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel/tema`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logo_url: '' })
        });
        if (response.ok) {
            const elLogo = document.getElementById('temaLogoUrl');
            if (elLogo) {
                elLogo.value = '';
            }
            await cargarNombreHotel();
            alert('Logotipo eliminado.');
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo quitar el logotipo.');
            alert(msg);
        }
    } catch (error) {
        if (error && error.message === 'Forbidden') return;
        alert('Error al quitar el logotipo.');
        console.error(error);
    }
}

function abrirSelectorFondoArchivo() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede subir la imagen de fondo.');
        return;
    }
    const input = document.getElementById('temaFondoArchivo');
    if (input) {
        input.click();
    }
}

async function subirFondoArchivoSeleccionado() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede subir la imagen de fondo.');
        return;
    }
    const input = document.getElementById('temaFondoArchivo');
    if (!input || !input.files || input.files.length === 0) {
        alert('Primero seleccione una imagen.');
        return;
    }
    const archivo = input.files[0];
    const formData = new FormData();
    formData.append('fondo', archivo);
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel/fondo-upload`, {
            method: 'POST',
            body: formData
        });
        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            const url = data && data.fondo_imagen_url ? String(data.fondo_imagen_url) : '';
            if (url) {
                const elFondo = document.getElementById('temaFondoImagenUrl');
                if (elFondo) {
                    elFondo.value = url;
                }
            }
            await cargarNombreHotel();
            alert('Imagen de fondo subida y aplicada correctamente.');
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo subir la imagen.');
            alert(msg);
        }
    } catch (error) {
        if (error && error.message === 'Forbidden') return;
        alert('Error al subir la imagen de fondo.');
        console.error(error);
    }
}

/** Extrae mensaje útil del cuerpo de una respuesta fallida fetch. */
async function mensajeErrorRespuestaFetch(response, fallback) {
    const text = await response.text().catch(() => '');
    try {
        const j = JSON.parse(text);
        if (j && j.error) return j.error;
    } catch (_) { /* ignorar */ }
    if (response.status === 404 && /Cannot (PUT|POST|GET|DELETE)\s+\/api\//i.test(text)) {
        return (
            'El servidor no tiene activa esta función (versión antigua). ' +
            'Detenga el proceso en la terminal (Ctrl+C) y vuelva a iniciar con: npm start'
        );
    }
    const frag = text && text.trim().length ? ` ${text.trim().slice(0, 120)}` : '';
    return `${fallback} (${response.status})${frag}`;
}

// ========== VISTAS DE INVENTARIO (habitaciones / chinchorros) ==========
const VISTAS_INVENTARIO = ['tarjetas', 'lista', 'tabla'];

function vistaInventarioNormalizada(v) {
    const s = v == null ? '' : String(v).trim().toLowerCase();
    return VISTAS_INVENTARIO.includes(s) ? s : 'tarjetas';
}

function textoVistaInventario(v) {
    const k = vistaInventarioNormalizada(v);
    if (k === 'lista') return 'lista compacta';
    if (k === 'tabla') return 'tabla';
    return 'tarjetas (cuadrícula)';
}

const ESTADOS_INVENTARIO = [
    'Disponible',
    'Ocupada',
    'Reservada',
    'En limpieza',
    'Fuera de servicio'
];

/** Habitaciones/chinchorros en limpieza o fuera de servicio no se ofrecen para reservar. */
function inventarioPermiteNuevaReserva(estado) {
    const e = String(estado || '').trim();
    return e !== 'En limpieza' && e !== 'Fuera de servicio';
}

function mensajeInventarioNoReservableUI(estado, tipo) {
    const e = String(estado || '').trim();
    if (inventarioPermiteNuevaReserva(e)) return '';
    const unidad = tipo === 'chinchorro' ? 'chinchorro' : 'habitación';
    return `Ese ${unidad} está en limpieza o fuera de servicio y no se puede reservar.`;
}

function recursoInventarioPorTipoId(tipo, id) {
    if (tipo === 'chinchorro') {
        return chinchorros.find((x) => Number(x.id) === Number(id));
    }
    return habitaciones.find((x) => Number(x.id) === Number(id));
}

/** Estados que el usuario puede elegir en el listado (no reserva ni fuera de servicio). */
const ESTADOS_HABITACION_LISTADO = ['Disponible', 'En limpieza'];

function claseEstadoBadgeRecurso(estado) {
    const e = String(estado == null ? '' : estado)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9áéíóúñ_-]+/gi, '-')
        .replace(/^-+|-+$/g, '');
    return `estado-badge estado-${e || 'desconocido'}`;
}

function habitacionConReservaActivaHoy(hab) {
    return Number(hab && (hab.reservas_ocupadas_hoy ?? hab.reservas_activas)) > 0;
}

function reservaEstaConCheckin(r) {
    return r && String(r.estado) === 'Activa' && r.checkin_at != null && String(r.checkin_at).trim() !== '';
}

function reservaPendienteCheckin(r) {
    return r && String(r.estado) === 'Pendiente de Check-in';
}

function reservaEsNoShow(r) {
    return r && String(r.estado) === 'No Presentado (No Show)';
}

function reservaBloqueaHabitacion(r) {
    const est = r && r.estado ? String(r.estado) : '';
    return est === 'Activa' || est === 'Pendiente de Check-in';
}

function claseEstadoReservaHabitacion(estado) {
    const e = String(estado || '');
    if (e === 'Activa') return 'estado-disponible';
    if (e === 'Pendiente de Check-in') return 'estado-reservada';
    if (e === 'No Presentado (No Show)') return 'estado-fuera-de-servicio';
    if (e === 'Finalizada') return 'estado-en-limpieza';
    return 'estado-ocupada';
}

function claseEstadoReservaChinchorro(estado) {
    const e = String(estado || '');
    if (e === 'Activa') return 'estado-disponible';
    if (e === 'Finalizada') return 'estado-en-limpieza';
    if (e === 'Cancelada') return 'estado-fuera-de-servicio';
    return 'estado-ocupada';
}

function habitacionEstadoSoloLecturaEnListado(hab) {
    const est = String((hab && hab.estado) || '').trim();
    if (habitacionConReservaActivaHoy(hab)) return true;
    if (est === 'Fuera de servicio') return true;
    if (est === 'Ocupada' || est === 'Reservada') return true;
    return false;
}

function textoAyudaEstadoHabitacionListado(hab) {
    const est = String((hab && hab.estado) || '').trim();
    if (habitacionConReservaActivaHoy(hab)) {
        return 'Ocupada por reserva activa. Gestione la reserva para liberar la habitación.';
    }
    if (est === 'Fuera de servicio') {
        return 'Fuera de servicio. Cámbielo desde el botón Modificar.';
    }
    if (est === 'Ocupada' || est === 'Reservada') {
        return 'Estado asignado por el sistema. Use Modificar o la reserva asociada.';
    }
    return '';
}

/** Estado real para mostrar (incluye ocupación por reserva activa hoy). */
function estadoEfectivoHabitacion(hab) {
    const est = ESTADOS_INVENTARIO.includes(hab && hab.estado) ? hab.estado : 'Disponible';
    if (est === 'Fuera de servicio' || est === 'En limpieza') return est;
    if (habitacionConReservaActivaHoy(hab)) return 'Ocupada';
    return est;
}

function habitacionEstaOcupada(hab) {
    return estadoEfectivoHabitacion(hab) === 'Ocupada';
}

function htmlEtiquetaEstadoHabitacion(hab) {
    const est = estadoEfectivoHabitacion(hab);
    const cls = claseEstadoBadgeRecurso(est);
    const titulo = textoAyudaEstadoHabitacionListado(hab);
    const etiqueta =
        habitacionConReservaActivaHoy(hab) && est === 'Ocupada' ? `${est} (reserva)` : est;
    return `<span class="${cls} estado-readonly estado-inline" title="${escapeHtmlCal(titulo)}">${escapeHtmlCal(etiqueta)}</span>`;
}

/** Huésped y saldo de la reserva activa hoy (API o listado de reservas en memoria). */
function resolverOcupacionHabitacion(hab) {
    if (!habitacionEstaOcupada(hab)) return null;

    let nombre = hab.ocupante_nombre != null ? String(hab.ocupante_nombre).trim() : '';
    let saldo = hab.reserva_saldo;
    let reservaId = hab.reserva_activa_id;

    if (!nombre) {
        const hoy = fechaLocalYMD();
        const r = reservas.find(
            (x) =>
                Number(x.habitacion_id) === Number(hab.id) &&
                (reservaOcupadaEnFecha(x, hoy) || reservaPendienteCheckinEnFecha(x, hoy))
        );
        if (r) {
            nombre = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim();
            reservaId = r.id;
            if (saldo == null || !Number.isFinite(Number(saldo))) {
                saldo = saldoReservaHabitacion(r);
            }
        }
    }

    if (!nombre) return { nombre: null, saldo: null, reservaId: reservaId || null };
    const saldoNum = saldo != null && Number.isFinite(Number(saldo)) ? Number(saldo) : null;
    return { nombre, saldo: saldoNum, reservaId: reservaId || null };
}

function textoHuespedOcupandoHabitacion(hab) {
    const occ = resolverOcupacionHabitacion(hab);
    return occ && occ.nombre ? occ.nombre : '';
}

function htmlCeldaHuespedHabitacion(hab) {
    if (!habitacionEstaOcupada(hab)) {
        return '<span class="muted">—</span>';
    }
    const nombre = textoHuespedOcupandoHabitacion(hab);
    if (nombre) {
        return `<strong class="hab-huesped-nombre">${escapeHtmlCal(nombre)}</strong>`;
    }
    return '<span class="muted">Sin huésped registrado</span>';
}

/** Huésped y saldo al estar ocupada (sin repetir el estado; ese va solo en la cabecera). */
function htmlDetalleOcupacionHabitacion(hab) {
    if (!habitacionEstaOcupada(hab)) return '';
    const occ = resolverOcupacionHabitacion(hab);
    const nombre = occ && occ.nombre ? occ.nombre : 'Sin huésped registrado';
    const saldo = occ && occ.saldo != null && Number.isFinite(occ.saldo) ? occ.saldo : 0;
    const pagoHtml =
        saldo > 0.005
            ? `<span class="hab-ocupacion-saldo">Debe: <strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(saldo))}</strong></span>`
            : '<span class="hab-ocupacion-saldo hab-ocupacion-saldo--ok">Al día</span>';
    return `
        <div class="hab-ocupacion-detalle" role="status">
            <p class="hab-ocupacion-huesped"><span class="hab-ocupacion-label">Huésped:</span> <strong>${escapeHtmlCal(nombre)}</strong></p>
            <p class="hab-ocupacion-pago">${pagoHtml}</p>
        </div>
    `;
}

function htmlEstadoHabitacionInventario(hab) {
    const est = estadoEfectivoHabitacion(hab);
    const cls = claseEstadoBadgeRecurso(est);
    const titulo = textoAyudaEstadoHabitacionListado(hab);
    const soloLectura =
        habitacionEstadoSoloLecturaEnListado(hab) || habitacionConReservaActivaHoy(hab);

    if (soloLectura) {
        const etiqueta =
            habitacionConReservaActivaHoy(hab) && est === 'Ocupada'
                ? `${est} (reserva)`
                : est;
        return `<span class="estado-badge estado-readonly ${cls}" title="${escapeHtmlCal(titulo)}">${escapeHtmlCal(etiqueta)}</span>`;
    }

    const opciones = ESTADOS_HABITACION_LISTADO.map((e) => {
        const sel = e === est ? ' selected' : '';
        return `<option value="${escapeHtmlCal(e)}"${sel}>${escapeHtmlCal(e)}</option>`;
    }).join('');
    return `<select class="select-estado-inventario ${cls}" data-estado-prev="${escapeHtmlCal(est)}" title="${escapeHtmlCal('Solo Disponible o En limpieza')}" aria-label="Estado de la habitación" onchange="actualizarEstadoHabitacionListado(${Number(hab.id)}, this)">${opciones}</select>`;
}

function htmlEstadoInventarioHabitacionCompleto(hab) {
    return htmlEstadoHabitacionInventario(hab);
}

function aplicarReglasSelectEstadoHabitacionModal(hab) {
    const sel = document.getElementById('estadoHabitacion');
    if (!sel) return;
    sel.disabled = false;
    Array.from(sel.options).forEach((opt) => {
        opt.disabled = false;
        opt.hidden = false;
        if (opt.value === 'Ocupada' || opt.value === 'Reservada') {
            opt.disabled = true;
            opt.hidden = true;
        }
    });
}

async function actualizarEstadoHabitacionListado(id, selectEl) {
    const nuevoEstado = selectEl.value;
    if (!ESTADOS_HABITACION_LISTADO.includes(nuevoEstado)) {
        alert('Solo puede elegir Disponible o En limpieza desde el listado.');
        selectEl.value = selectEl.dataset.estadoPrev || 'Disponible';
        return;
    }
    const anterior =
        selectEl.dataset.estadoPrev ||
        (habitaciones.find((x) => Number(x.id) === Number(id)) || {}).estado ||
        'Disponible';
    if (nuevoEstado === anterior) return;

    selectEl.disabled = true;
    try {
        const response = await fetchWithAuth(`${API_URL}/habitaciones/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        if (response.ok) {
            const hab = habitaciones.find((x) => Number(x.id) === Number(id));
            if (hab) hab.estado = nuevoEstado;
            selectEl.dataset.estadoPrev = nuevoEstado;
            selectEl.className = `select-estado-inventario ${claseEstadoBadgeRecurso(nuevoEstado)}`;
            cargarHabitaciones();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'No se pudo actualizar el estado'));
            selectEl.value = anterior;
            selectEl.className = `select-estado-inventario ${claseEstadoBadgeRecurso(anterior)}`;
        }
    } catch (error) {
        alert('Error al cambiar el estado de la habitación');
        console.error(error);
        selectEl.value = anterior;
        selectEl.className = `select-estado-inventario ${claseEstadoBadgeRecurso(anterior)}`;
    } finally {
        selectEl.disabled = false;
    }
}

const ESTADOS_CHINCHORRO_LISTADO = ['Disponible', 'En limpieza'];

function chinchorroConReservaActivaHoy(ch) {
    return Number(ch && ch.reservas_activas) > 0;
}

function chinchorroEstadoSoloLecturaEnListado(ch) {
    const est = String((ch && ch.estado) || '').trim();
    if (chinchorroConReservaActivaHoy(ch)) return true;
    if (est === 'Fuera de servicio') return true;
    if (est === 'Ocupada' || est === 'Reservada') return true;
    return false;
}

function textoAyudaEstadoChinchorroListado(ch) {
    const est = String((ch && ch.estado) || '').trim();
    if (chinchorroConReservaActivaHoy(ch)) {
        return 'Ocupado por reserva activa. Gestione la reserva para liberar el chinchorro.';
    }
    if (est === 'Fuera de servicio') {
        return 'Fuera de servicio. Cámbielo desde el botón Modificar.';
    }
    if (est === 'Ocupada' || est === 'Reservada') {
        return 'Estado asignado por el sistema. Use Modificar o la reserva asociada.';
    }
    return '';
}

function htmlEstadoChinchorroInventario(ch) {
    const est = ESTADOS_INVENTARIO.includes(ch.estado) ? ch.estado : 'Disponible';
    const cls = claseEstadoBadgeRecurso(est);
    const titulo = textoAyudaEstadoChinchorroListado(ch);

    if (chinchorroEstadoSoloLecturaEnListado(ch)) {
        const etiqueta =
            chinchorroConReservaActivaHoy(ch) && est === 'Ocupada'
                ? `${est} (reserva)`
                : est;
        return `<span class="estado-badge estado-readonly ${cls}" title="${escapeHtmlCal(titulo)}">${escapeHtmlCal(etiqueta)}</span>`;
    }

    const opciones = ESTADOS_CHINCHORRO_LISTADO.map((e) => {
        const sel = e === est ? ' selected' : '';
        return `<option value="${escapeHtmlCal(e)}"${sel}>${escapeHtmlCal(e)}</option>`;
    }).join('');
    return `<select class="select-estado-inventario ${cls}" data-estado-prev="${escapeHtmlCal(est)}" title="${escapeHtmlCal('Solo Disponible o En limpieza')}" aria-label="Estado del chinchorro" onchange="actualizarEstadoChinchorroListado(${Number(ch.id)}, this)">${opciones}</select>`;
}

function aplicarReglasSelectEstadoChinchorroModal(ch) {
    const sel = document.getElementById('estadoChinchorro');
    if (!sel) return;
    const conReserva = ch && chinchorroConReservaActivaHoy(ch);
    Array.from(sel.options).forEach((opt) => {
        opt.disabled = false;
        opt.hidden = false;
    });
    if (conReserva) {
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    Array.from(sel.options).forEach((opt) => {
        if (opt.value === 'Ocupada' || opt.value === 'Reservada') {
            opt.disabled = true;
            opt.hidden = true;
        }
    });
}

async function actualizarEstadoChinchorroListado(id, selectEl) {
    const nuevoEstado = selectEl.value;
    if (!ESTADOS_CHINCHORRO_LISTADO.includes(nuevoEstado)) {
        alert('Solo puede elegir Disponible o En limpieza desde el listado.');
        selectEl.value = selectEl.dataset.estadoPrev || 'Disponible';
        return;
    }
    const anterior =
        selectEl.dataset.estadoPrev ||
        (chinchorros.find((x) => Number(x.id) === Number(id)) || {}).estado ||
        'Disponible';
    if (nuevoEstado === anterior) return;

    selectEl.disabled = true;
    try {
        const response = await fetchWithAuth(`${API_URL}/chinchorros/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        if (response.ok) {
            const ch = chinchorros.find((x) => Number(x.id) === Number(id));
            if (ch) ch.estado = nuevoEstado;
            selectEl.dataset.estadoPrev = nuevoEstado;
            selectEl.className = `select-estado-inventario ${claseEstadoBadgeRecurso(nuevoEstado)}`;
            cargarChinchorros();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.error || 'No se pudo actualizar el estado'));
            selectEl.value = anterior;
            selectEl.className = `select-estado-inventario ${claseEstadoBadgeRecurso(anterior)}`;
        }
    } catch (error) {
        alert('Error al cambiar el estado del chinchorro');
        console.error(error);
        selectEl.value = anterior;
        selectEl.className = `select-estado-inventario ${claseEstadoBadgeRecurso(anterior)}`;
    } finally {
        selectEl.disabled = false;
    }
}

function aplicarLayoutWrapInventario(wrapId, campoHotel) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const d = datosHotelCache || {};
    const vista = vistaInventarioNormalizada(d[campoHotel]);

    wrap.classList.remove('vista-inventario-tarjetas', 'vista-inventario-lista', 'vista-inventario-tabla');
    wrap.classList.add(`vista-inventario-${vista}`);

    let gridId = '';
    let tablaWrapId = '';
    if (wrapId === 'wrapVistaHabitaciones') {
        gridId = 'gridHabitaciones';
        tablaWrapId = 'wrapTablaHabitaciones';
    } else if (wrapId === 'wrapVistaChinchorros') {
        gridId = 'gridChinchorros';
        tablaWrapId = 'wrapTablaChinchorros';
    }

    const grid = gridId ? document.getElementById(gridId) : null;
    if (grid) {
        grid.classList.toggle('vista-recursos-lista', vista === 'lista');
    }

    const tablaWrap = tablaWrapId ? document.getElementById(tablaWrapId) : null;
    if (tablaWrap) {
        const showTabla = vista === 'tabla';
        tablaWrap.classList.toggle('tabla-inventario-oculta', !showTabla);
        tablaWrap.setAttribute('aria-hidden', showTabla ? 'false' : 'true');
    }
}

function aplicarLayoutsVistasInventarioDesdeHotel() {
    aplicarLayoutWrapInventario('wrapVistaHabitaciones', 'vista_habitaciones');
    aplicarLayoutWrapInventario('wrapVistaChinchorros', 'vista_chinchorros');
}

function sincronizarSelectsYResumenVistas() {
    const selH = document.getElementById('selVistaHabitaciones');
    const selC = document.getElementById('selVistaChinchorros');
    const lect = document.getElementById('vistasInventarioLectura');
    const vh = datosHotelCache ? vistaInventarioNormalizada(datosHotelCache.vista_habitaciones) : 'tarjetas';
    const vc = datosHotelCache ? vistaInventarioNormalizada(datosHotelCache.vista_chinchorros) : 'tarjetas';
    if (selH) selH.value = vh;
    if (selC) selC.value = vc;
    if (lect) {
        lect.textContent =
            `Habitaciones: ${textoVistaInventario(vh)}. Chinchorros: ${textoVistaInventario(vc)}. ` +
            (usuarioEsAdministrador()
                ? 'Puede cambiar ambas opciones más abajo y pulsar «Guardar vistas».'
                : 'Solo un administrador puede cambiar estos modos de vista desde esta página.');
    }
}

// ========== FUNCIONES DEL HOTEL ==========
async function cargarNombreHotel() {
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel`);
        const data = await response.json();
        datosHotelCache = data;
        if (typeof TemaHotel !== 'undefined') {
            TemaHotel.aplicarMarcaHotel(document, data);
        } else {
            const nombre = data.nombre || 'Mi Hotel';
            document.getElementById('hotelNombre').textContent = nombre;
            document.title = nombre;
        }
        rellenarCamposTemaDesdeHotel(data);
        aplicarLayoutsVistasInventarioDesdeHotel();
        sincronizarSelectsYResumenVistas();
        if (typeof habitaciones !== 'undefined' && Array.isArray(habitaciones)) {
            mostrarHabitaciones();
        }
        if (typeof chinchorros !== 'undefined' && Array.isArray(chinchorros)) {
            mostrarChinchorros();
        }
    } catch (error) {
        console.error('Error al cargar nombre del hotel:', error);
    }
}

async function guardarTemaApariencia() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede modificar los colores.');
        return;
    }
    const body = {
        color_primario: document.getElementById('temaColorPrimario').value,
        color_secundario: document.getElementById('temaColorSecundario').value,
        color_acento: document.getElementById('temaColorAcento').value,
        color_titulo: document.getElementById('temaColorTitulo').value,
        fondo_imagen_url: document.getElementById('temaFondoImagenUrl').value.trim(),
        logo_url: document.getElementById('temaLogoUrl').value.trim()
    };
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel/tema`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            try {
                const datos = await response.json();
                if (typeof TemaHotel !== 'undefined' && datos) {
                    TemaHotel.aplicar(document, datos);
                }
            } catch (_) {
                /* si no viene JSON seguimos igual */
            }
            await cargarNombreHotel();
            alert('Apariencia guardada correctamente.');
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo guardar la apariencia.');
            alert(msg);
        }
    } catch (error) {
        if (error && error.message === 'Forbidden') return;
        alert('Error al guardar la apariencia.');
        console.error(error);
    }
}

async function restaurarTemaApariencia() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede restaurar la apariencia.');
        return;
    }
    if (!confirm('¿Restaurar apariencia predeterminada (colores, fondo y logotipo)?')) {
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel/tema`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reiniciar: true })
        });
        if (response.ok) {
            await cargarNombreHotel();
            alert('Se restauró la apariencia predeterminada.');
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo restaurar.');
            alert(msg);
        }
    } catch (error) {
        if (error && error.message === 'Forbidden') return;
        alert('Error al restaurar.');
        console.error(error);
    }
}

async function guardarVistasInventario() {
    if (!usuarioEsAdministrador()) {
        alert('Solo el administrador puede cambiar las vistas del inventario.');
        return;
    }
    const body = {
        vista_habitaciones: vistaInventarioNormalizada(document.getElementById('selVistaHabitaciones').value),
        vista_chinchorros: vistaInventarioNormalizada(document.getElementById('selVistaChinchorros').value)
    };
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel/vistas`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            await cargarNombreHotel();
            alert('Vistas guardadas. Se aplican en las pestañas Habitaciones y Chinchorros.');
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudieron guardar las vistas.');
            alert(msg);
        }
    } catch (error) {
        if (error && error.message === 'Forbidden') return;
        alert('Error al guardar las vistas.');
        console.error(error);
    }
}

function editarNombreHotel() {
    const modal = document.getElementById('modalNombreHotel');
    const input = document.getElementById('inputNombreHotel');
    const nombreActual = document.getElementById('hotelNombre').textContent;
    input.value = nombreActual;
    modal.classList.add('active');
}

async function guardarNombreHotel() {
    const nombre = document.getElementById('inputNombreHotel').value.trim();
    if (!nombre) {
        alert('El nombre del hotel no puede estar vacío');
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_URL}/hotel`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre })
        });
        
        if (response.ok) {
            cerrarModal('modalNombreHotel');
            let nombreGuardado = nombre;
            try {
                const payload = await response.json();
                if (payload && payload.nombre) {
                    nombreGuardado = String(payload.nombre).trim();
                }
            } catch (_) { /* ignore */ }
            datosHotelCache = { ...(datosHotelCache || {}), nombre: nombreGuardado };
            if (typeof TemaHotel !== 'undefined') {
                TemaHotel.aplicarMarcaHotel(document, datosHotelCache);
            } else {
                document.getElementById('hotelNombre').textContent = nombreGuardado;
                document.title = nombreGuardado;
            }
            await cargarNombreHotel();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al guardar el nombre del hotel');
        console.error(error);
    }
}

// ========== FUNCIONES DE HABITACIONES ==========
async function cargarHabitaciones() {
    try {
        const response = await fetchWithAuth(`${API_URL}/habitaciones`);
        habitaciones = await response.json();
        mostrarHabitaciones();
    } catch (error) {
        console.error('Error al cargar habitaciones:', error);
    }
}

function actualizarResumenOcupacion() {
    const panel = document.getElementById('resumenOcupacion');
    if (!panel) return;

    const total = habitaciones.length;
    const ocupadas = habitaciones.filter((h) => estadoEfectivoHabitacion(h) === 'Ocupada').length;
    const disponibles = habitaciones.filter((h) => estadoEfectivoHabitacion(h) === 'Disponible').length;
    const pct = total > 0 ? Math.round((ocupadas / total) * 100) : 0;
    const wDisp = total > 0 ? (disponibles / total) * 100 : 0;
    const wOcup = total > 0 ? (ocupadas / total) * 100 : 0;

    const ariaBar = total
        ? `${disponibles} disponibles, ${ocupadas} ocupadas, ${pct}% de ocupación`
        : 'Sin habitaciones registradas';

    panel.innerHTML = `
        <div class="ocupacion-chips">
            <span class="ocupacion-chip chip-total" title="Habitaciones en el sistema">
                <span class="chip-label">Total</span>
                <span class="chip-value">${total}</span>
            </span>
            <span class="ocupacion-chip chip-disponible" title="Libres en este momento">
                <span class="chip-label">Disponibles</span>
                <span class="chip-value">${disponibles}</span>
            </span>
            <span class="ocupacion-chip chip-ocupada" title="Ocupadas o no disponibles">
                <span class="chip-label">Ocupadas</span>
                <span class="chip-value">${ocupadas}</span>
            </span>
            <span class="ocupacion-chip chip-porcentaje" title="Porcentaje de habitaciones ocupadas">
                <span class="chip-label">Ocupación</span>
                <span class="chip-value">${pct}%</span>
            </span>
        </div>
        <div class="ocupacion-bar-wrap">
            <div class="ocupacion-bar" role="img" aria-label="${ariaBar.replace(/"/g, '&quot;')}">
                ${total ? `<span class="ocupacion-bar-segment bar-disponible" style="width:${wDisp}%"></span>` : ''}
                ${total ? `<span class="ocupacion-bar-segment bar-ocupada" style="width:${wOcup}%"></span>` : ''}
                ${!total ? '<span class="ocupacion-bar-vacio">Sin datos de ocupación</span>' : ''}
            </div>
        </div>
    `;
}

function htmlOcupacionCard(titulo, total, disponibles, ocupadas) {
    const pct = total > 0 ? Math.round((ocupadas / total) * 100) : 0;
    const wDisp = total > 0 ? (disponibles / total) * 100 : 0;
    const wOcup = total > 0 ? (ocupadas / total) * 100 : 0;
    const ariaBar = total
        ? `${disponibles} disponibles, ${ocupadas} ocupadas, ${pct}% ocupación`
        : 'Sin registros';
    return `
        <div class="ocupacion-panel ocupacion-panel-compact">
            <h3 class="ocupacion-card-titulo">${titulo}</h3>
            <div class="ocupacion-chips">
                <span class="ocupacion-chip chip-total"><span class="chip-label">Total</span><span class="chip-value">${total}</span></span>
                <span class="ocupacion-chip chip-disponible"><span class="chip-label">Libres</span><span class="chip-value">${disponibles}</span></span>
                <span class="ocupacion-chip chip-ocupada"><span class="chip-label">Ocup.</span><span class="chip-value">${ocupadas}</span></span>
                <span class="ocupacion-chip chip-porcentaje"><span class="chip-label">%</span><span class="chip-value">${pct}%</span></span>
            </div>
            <div class="ocupacion-bar-wrap">
                <div class="ocupacion-bar" role="img" aria-label="${ariaBar.replace(/"/g, '&quot;')}">
                    ${total ? `<span class="ocupacion-bar-segment bar-disponible" style="width:${wDisp}%"></span>` : ''}
                    ${total ? `<span class="ocupacion-bar-segment bar-ocupada" style="width:${wOcup}%"></span>` : ''}
                    ${!total ? '<span class="ocupacion-bar-vacio">Sin datos</span>' : ''}
                </div>
            </div>
        </div>
    `;
}

function refrescarPanelesOcupacionDual() {
    const elH = document.getElementById('dualPanelHabitaciones');
    const elC = document.getElementById('dualPanelChinchorros');
    if (elH) {
        const t = habitaciones.length;
        const o = habitaciones.filter((h) => estadoEfectivoHabitacion(h) === 'Ocupada').length;
        const d = habitaciones.filter((h) => estadoEfectivoHabitacion(h) === 'Disponible').length;
        elH.innerHTML = htmlOcupacionCard('🏨 Habitaciones', t, d, o);
    }
    if (elC) {
        const t = chinchorros.length;
        const o = chinchorros.filter((c) => c.estado === 'Ocupada').length;
        const d = chinchorros.filter((c) => c.estado === 'Disponible').length;
        elC.innerHTML = htmlOcupacionCard('🛋️ Chinchorros', t, d, o);
    }
}

function pct(numerador, denominador) {
    if (!denominador || denominador <= 0) return 0;
    return Math.round((numerador / denominador) * 100);
}

function htmlIndicadorCard(titulo, valor, subtitulo, disponible, ocupado) {
    return `
        <article class="indicador-card">
            <h3 class="indicador-titulo">${titulo}</h3>
            <div class="indicador-valor">${valor}%</div>
            <p class="indicador-subtitulo">${subtitulo}</p>
            <div class="indicador-detalle">
                <span><strong>${disponible}</strong> disponible(s)</span>
                <span><strong>${ocupado}</strong> ocupado(s)</span>
            </div>
        </article>
    `;
}

function renderIndicadoresOcupacion() {
    const grid = document.getElementById('indicadoresOcupacionGrid');
    if (!grid) return;

    const totalHabitaciones = habitaciones.length;
    const ocupadasHabitaciones = habitaciones.filter((h) => h.estado === 'Ocupada').length;
    const disponiblesHabitaciones = habitaciones.filter((h) => h.estado === 'Disponible').length;

    const totalChinchorros = chinchorros.length;
    const ocupadosChinchorros = chinchorros.filter((c) => c.estado === 'Ocupada').length;
    const disponiblesChinchorros = chinchorros.filter((c) => c.estado === 'Disponible').length;

    const totalRecursos = totalHabitaciones + totalChinchorros;
    const totalOcupados = ocupadasHabitaciones + ocupadosChinchorros;
    const totalDisponibles = disponiblesHabitaciones + disponiblesChinchorros;

    const reservasActivasHab = reservas.filter((r) => r.estado === 'Activa').length;
    const reservasActivasChin = reservasChinchorros.filter((r) => r.estado === 'Activa').length;
    const reservasActivasTotal = reservasActivasHab + reservasActivasChin;
    const totalReservas = reservas.length + reservasChinchorros.length;

    grid.innerHTML = `
        ${htmlIndicadorCard(
            'Ocupación habitaciones',
            pct(ocupadasHabitaciones, totalHabitaciones),
            `Total habitaciones: ${totalHabitaciones}`,
            disponiblesHabitaciones,
            ocupadasHabitaciones
        )}
        ${htmlIndicadorCard(
            'Ocupación chinchorros',
            pct(ocupadosChinchorros, totalChinchorros),
            `Total chinchorros: ${totalChinchorros}`,
            disponiblesChinchorros,
            ocupadosChinchorros
        )}
        ${htmlIndicadorCard(
            'Ocupación global',
            pct(totalOcupados, totalRecursos),
            `Recursos totales: ${totalRecursos}`,
            totalDisponibles,
            totalOcupados
        )}
        ${htmlIndicadorCard(
            'Reservas activas',
            pct(reservasActivasTotal, totalReservas),
            `Reservas registradas: ${totalReservas}`,
            totalReservas - reservasActivasTotal,
            reservasActivasTotal
        )}
    `;
}

function reservasHabitacionAlojadasHoy() {
    const hoy = fechaLocalYMD();
    return reservas
        .filter((r) => reservaOcupadaEnFecha(r, hoy) || reservaPendienteCheckinEnFecha(r, hoy))
        .sort((a, b) =>
            etiquetaHabitacionReserva(a).localeCompare(etiquetaHabitacionReserva(b), 'es', { sensitivity: 'base' })
        );
}

function textoPersonasReservaHabitacion(r) {
    const adultos = Number(r.adultos || 1);
    const ninos = Number(r.ninos || 0);
    const hab = habitaciones.find((h) => Number(h.id) === Number(r.habitacion_id));
    const cap = hab && hab.capacidad_personas ? Number(hab.capacidad_personas) : null;
    const base = `${adultos} adulto(s)${ninos > 0 ? `, ${ninos} niño(s)` : ''}`;
    return cap ? `${base} · máx. ${cap}` : base;
}

function htmlAccionesAcomodacionDia(r) {
    const id = Number(r.id);
    if (reservaPendienteCheckin(r)) {
        return `
        <div class="acomodacion-dia-acciones">
            <button type="button" class="btn-primary btn-small" onclick="confirmarCheckinReserva(${id})" title="Confirmar llegada">✅ Check-in</button>
        </div>`;
    }
    const saldo = saldoReservaHabitacion(r);
    if (saldo <= 0.005) {
        return '<span class="estado-badge estado-disponible">Pagado</span>';
    }
    return `
        <div class="acomodacion-dia-acciones">
            <button type="button" class="btn-primary btn-small" onclick="mostrarModalAbonoHabitacion(${id})" title="Registrar abono">Abonar</button>
            <button type="button" class="btn-secondary btn-small" onclick="totalizarReservaHabitacionPago(${id})" title="Cobrar saldo completo">Totalizar</button>
        </div>
    `;
}

function renderAcomodacionDelDia() {
    const panel = document.getElementById('panelAcomodacionDia');
    if (!panel) return;

    const hoy = fechaLocalYMD();
    const lista = reservasHabitacionAlojadasHoy();
    const fechaFmt = new Date(`${hoy}T12:00:00`).toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    if (lista.length === 0) {
        panel.innerHTML = `
            <div class="acomodacion-dia-header">
                <h3 class="subsection-title subsection-title--compact">Acomodación de hoy</h3>
                <span class="acomodacion-dia-fecha muted">${escapeHtmlCal(fechaFmt)}</span>
            </div>
            <p class="acomodacion-dia-vacio">No hay huéspedes alojados hoy en habitaciones.</p>
        `;
        return;
    }

    let sumTotal = 0;
    let sumSaldo = 0;
    let sumAbonado = 0;
    lista.forEach((r) => {
        const total = valorMonetarioReservaHabitacion(r);
        sumTotal += total;
        sumSaldo += saldoReservaHabitacion(r);
        sumAbonado += Math.min(montoAbonadoReserva(r), total);
    });

    const filas = lista
        .map((r) => {
            const total = valorMonetarioReservaHabitacion(r);
            const saldo = saldoReservaHabitacion(r);
            const abonado = Math.min(montoAbonadoReserva(r), total);
            const salida = new Date(`${ymdReservaSalida(r)}T12:00:00`).toLocaleDateString('es-ES');
            const noches = unidadesEstadiaYMD(r.fecha_ingreso, r.fecha_salida);
            const tarifa = Number(r.habitacion_precio_diario) || 0;
            const huesped = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim() || 'Huésped';
            const saldoHtml =
                saldo > 0.005
                    ? `<strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(saldo))}</strong>`
                    : '<span class="muted">—</span>';
            return `
            <tr>
                <td><strong>${escapeHtmlCal(etiquetaHabitacionReserva(r))}</strong></td>
                <td>${escapeHtmlCal(huesped)}</td>
                <td>${escapeHtmlCal(textoPersonasReservaHabitacion(r))}</td>
                <td>${escapeHtmlCal(salida)}</td>
                <td>${escapeHtmlCal(formatoMoneda(tarifa))}</td>
                <td><strong>${escapeHtmlCal(formatoMoneda(total))}</strong> <span class="muted">(${noches} noches)</span></td>
                <td>${escapeHtmlCal(formatoMoneda(abonado))}</td>
                <td>${saldoHtml}</td>
                <td class="td-acciones-acomodacion-dia">${htmlAccionesAcomodacionDia(r)}</td>
            </tr>`;
        })
        .join('');

    panel.innerHTML = `
        <div class="acomodacion-dia-header">
            <h3 class="subsection-title subsection-title--compact">Acomodación de hoy</h3>
            <span class="acomodacion-dia-fecha muted">${escapeHtmlCal(fechaFmt)}</span>
        </div>
        <p class="acomodacion-dia-intro">
            Huéspedes alojados hoy: total de la estadía y saldo pendiente de cada reserva.
            El registro unificado de todas las reservas continúa en la misma pestaña, justo debajo.
        </p>
        <div class="acomodacion-dia-chips">
            <span class="ocupacion-chip chip-total"><span class="chip-label">Habitaciones</span><span class="chip-value">${lista.length}</span></span>
            <span class="ocupacion-chip chip-disponible"><span class="chip-label">Total estadías</span><span class="chip-value">${escapeHtmlCal(formatoMoneda(sumTotal))}</span></span>
            <span class="ocupacion-chip chip-ocupada"><span class="chip-label">Saldo pendiente</span><span class="chip-value">${escapeHtmlCal(formatoMoneda(sumSaldo))}</span></span>
            <span class="ocupacion-chip chip-porcentaje"><span class="chip-label">Abonado</span><span class="chip-value">${escapeHtmlCal(formatoMoneda(sumAbonado))}</span></span>
        </div>
        <div class="table-container acomodacion-dia-tabla-wrap">
            <table class="data-table acomodacion-dia-tabla">
                <thead>
                    <tr>
                        <th>Habitación</th>
                        <th>Huésped</th>
                        <th>Personas</th>
                        <th>Salida</th>
                        <th>Tarifa / noche</th>
                        <th>Total a cobrar</th>
                        <th>Abonado</th>
                        <th>Debe</th>
                        <th>Cobro</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
                <tfoot>
                    <tr class="acomodacion-dia-total-fila">
                        <td colspan="5"><strong>Total del día (${lista.length} habitación${lista.length === 1 ? '' : 'es'})</strong></td>
                        <td><strong>${escapeHtmlCal(formatoMoneda(sumTotal))}</strong></td>
                        <td><strong>${escapeHtmlCal(formatoMoneda(sumAbonado))}</strong></td>
                        <td><strong class="txt-saldo-pendiente">${escapeHtmlCal(formatoMoneda(sumSaldo))}</strong></td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function mostrarHabitaciones() {
    const grid = document.getElementById('gridHabitaciones');
    const tbody = document.getElementById('tablaHabitacionesInv');

    actualizarResumenOcupacion();
    renderGestionOperativa();

    aplicarLayoutsVistasInventarioDesdeHotel();

    const v = vistaInventarioNormalizada(datosHotelCache && datosHotelCache.vista_habitaciones);
    const vacioGrid =
        '<p style="text-align: center; color: #666; padding: 40px;">No hay habitaciones registradas. Crea una nueva habitación para comenzar.</p>';
    const vacioTabla =
        '<tr><td colspan="8" style="text-align: center; padding: 24px; color: #666;">No hay habitaciones registradas.</td></tr>';

    if (habitaciones.length === 0) {
        if (grid) grid.innerHTML = vacioGrid;
        if (tbody) tbody.innerHTML = vacioTabla;
        return;
    }

    const listaHabitaciones = habitacionesFiltradas();
    if (listaHabitaciones.length === 0) {
        if (grid) grid.innerHTML = '<p style="text-align: center; color: #666; padding: 30px;">Sin resultados para la búsqueda actual.</p>';
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }

    if (v === 'tabla') {
        if (grid) grid.innerHTML = '';
        if (tbody) {
            tbody.innerHTML = listaHabitaciones
                .map((habitacion) => {
                    const est = habitacion.estado || '';
                    const etiquetaJson = JSON.stringify(etiquetaHabitacion(habitacion));
                    return `
            <tr>
                <td><strong>${escapeHtmlCal(etiquetaHabitacion(habitacion))}</strong></td>
                <td>${escapeHtmlCal(habitacion.tipo || 'N/A')}</td>
                <td>${escapeHtmlCal(habitacion.piso || '-')}</td>
                <td>${escapeHtmlCal(String(habitacion.capacidad_personas || 1))} pers.</td>
                <td>${escapeHtmlCal(String(habitacion.total_camas ?? 0))}</td>
                <td class="td-estado-inventario">${htmlEstadoInventarioHabitacionCompleto(habitacion)}</td>
                <td class="td-huesped-habitacion">${htmlCeldaHuespedHabitacion(habitacion)}</td>
                <td class="td-acciones-inventario">
                    <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarHabitacion(${habitacion.id})">✏️ Modificar</button>
                    <button type="button" class="btn-primary btn-small" onclick="gestionarCamas(${habitacion.id}, ${etiquetaJson})">🛏️ Camas</button>
                    <button type="button" class="btn-danger btn-small" onclick="eliminarHabitacion(${habitacion.id})">🗑️ Eliminar</button>
                </td>
            </tr>`;
                })
                .join('');
        }
        return;
    }

    if (tbody) tbody.innerHTML = '';
    if (!grid) return;
    grid.innerHTML = '';

    listaHabitaciones.forEach((habitacion) => {
        const card = document.createElement('div');
        card.className = 'habitacion-card';
        const precio = formatoMoneda(Number(habitacion.precio_diario) || 0);
        const est = habitacion.estado || '';
        card.innerHTML = `
            <div class="habitacion-header">
                <div class="habitacion-numero">${escapeHtmlCal(habitacion.codigo || `Habitación ${habitacion.numero}`)}</div>
                ${htmlEstadoHabitacionInventario(habitacion)}
            </div>
            ${htmlDetalleOcupacionHabitacion(habitacion)}
            <div class="habitacion-info">
                <p><strong>Número:</strong> ${escapeHtmlCal(habitacion.numero)}</p>
                <p><strong>Nombre:</strong> ${escapeHtmlCal(habitacion.nombre || '-')}</p>
                <p><strong>Tipo:</strong> ${escapeHtmlCal(habitacion.tipo || 'N/A')}</p>
                <p><strong>Acomodación:</strong> ${escapeHtmlCal(String(habitacion.capacidad_personas || 1))} persona(s)</p>
                <p><strong>Piso / nivel:</strong> ${escapeHtmlCal(habitacion.piso || '-')}</p>
                <p><strong>Tarifa / noche:</strong> ${escapeHtmlCal(precio)}</p>
                <p><strong>Camas:</strong> ${escapeHtmlCal(String(habitacion.total_camas || 0))}</p>
            </div>
            <div class="habitacion-acciones">
                <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarHabitacion(${habitacion.id})">✏️ Modificar</button>
                <button class="btn-primary btn-small" onclick="gestionarCamas(${habitacion.id}, ${JSON.stringify(
                    habitacion.numero != null ? String(habitacion.numero) : ''
                )})">
                    🛏️ Camas
                </button>
                <button class="btn-danger btn-small" onclick="eliminarHabitacion(${habitacion.id})">
                    🗑️ Eliminar
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function mostrarBloqueCamasNuevaHabitacion(visible) {
    const bloque = document.getElementById('bloqueCamasNuevaHabitacion');
    if (bloque) bloque.hidden = !visible;
}

function construirCamasNuevaHabitacion() {
    const cantidad = parseInt(document.getElementById('cantidadCamasHabitacion').value, 10) || 0;
    if (cantidad < 1) return [];
    const tipo = document.getElementById('tipoCamaHabitacion').value || 'Individual';
    const camas = [];
    for (let i = 1; i <= cantidad; i += 1) {
        camas.push({ tipo, numero: i });
    }
    return camas;
}

function mostrarModalHabitacion() {
    document.getElementById('formHabitacion').reset();
    document.getElementById('idHabitacionEdicion').value = '';
    document.getElementById('tituloModalHabitacion').textContent = 'Nueva habitación';
    const hint = document.getElementById('mensajeAyudaModalHabitacion');
    if (hint) hint.hidden = true;
    const btn = document.getElementById('btnSubmitHabitacion');
    if (btn) btn.textContent = 'Guardar';
    document.getElementById('tipoHabitacion').value = 'Sencilla';
    document.getElementById('capacidadHabitacion').value = '1';
    document.getElementById('cantidadCamasHabitacion').value = '1';
    document.getElementById('tipoCamaHabitacion').value = 'Individual';
    document.getElementById('estadoHabitacion').value = 'Disponible';
    mostrarBloqueCamasNuevaHabitacion(true);
    aplicarReglasSelectEstadoHabitacionModal(null);
    document.getElementById('modalHabitacion').classList.add('active');
}

function mostrarModalEditarHabitacion(id) {
    const hab = habitaciones.find((x) => Number(x.id) === Number(id));
    if (!hab) return;
    document.getElementById('idHabitacionEdicion').value = String(hab.id);
    document.getElementById('nombreHabitacion').value = etiquetaHabitacion(hab);
    document.getElementById('tipoHabitacion').value = hab.tipo || 'Sencilla';
    document.getElementById('capacidadHabitacion').value = String(Math.min(5, Math.max(1, Number(hab.capacidad_personas) || 1)));
    document.getElementById('pisoHabitacion').value = hab.piso != null ? String(hab.piso) : '';
    document.getElementById('estadoHabitacion').value = hab.estado || 'Disponible';
    mostrarBloqueCamasNuevaHabitacion(false);
    aplicarReglasSelectEstadoHabitacionModal(hab);
    document.getElementById('tituloModalHabitacion').textContent = 'Modificar habitación';
    const hint = document.getElementById('mensajeAyudaModalHabitacion');
    if (hint) {
        hint.hidden = false;
        hint.innerHTML =
            'Puede cambiar nombre, tipo, acomodación, piso y estado. Las camas se gestionan con el botón <strong>Camas</strong> del listado. Elija <strong>En limpieza</strong> o <strong>Fuera de servicio</strong> cuando corresponda. Ocupada y Reservada las asigna el sistema con las reservas. La tarifa por noche se define en <strong>Reservas</strong>.';
    }
    const btn = document.getElementById('btnSubmitHabitacion');
    if (btn) btn.textContent = 'Guardar cambios';
    document.getElementById('modalHabitacion').classList.add('active');
}

async function guardarHabitacion(event) {
    event.preventDefault();
    const idEd = document.getElementById('idHabitacionEdicion').value.trim();
    const nombre = document.getElementById('nombreHabitacion').value.trim();
    const tipo = document.getElementById('tipoHabitacion').value.trim();
    const capacidad_personas = Math.min(5, Math.max(1, parseInt(document.getElementById('capacidadHabitacion').value, 10) || 1));
    const piso = document.getElementById('pisoHabitacion').value.trim();
    const estado = document.getElementById('estadoHabitacion').value;
    if (!nombre) {
        alert('El nombre de la habitación es obligatorio');
        return;
    }

    try {
        let response;
        if (idEd) {
            response = await fetchWithAuth(`${API_URL}/habitaciones/${parseInt(idEd, 10)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, tipo, piso, estado, capacidad_personas })
            });
        } else {
            const camas = construirCamasNuevaHabitacion();
            response = await fetchWithAuth(`${API_URL}/habitaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, tipo, piso, estado, capacidad_personas, camas })
            });
        }

        if (response.ok) {
            cerrarModal('modalHabitacion');
            cargarHabitaciones();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al guardar la habitación');
        console.error(error);
    }
}

async function eliminarHabitacion(id) {
    if (!confirm('¿Estás seguro de eliminar esta habitación? Esto también eliminará todas sus camas y reservas.')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_URL}/habitaciones/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            cargarHabitaciones();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al eliminar la habitación');
        console.error(error);
    }
}

// ========== CHINCHORROS Y RESERVAS DE CHINCHORROS ==========
async function cargarChinchorros() {
    try {
        const response = await fetchWithAuth(`${API_URL}/chinchorros`);
        chinchorros = await response.json();
        mostrarChinchorros();
    } catch (error) {
        console.error('Error al cargar chinchorros:', error);
    }
}

function mostrarChinchorros() {
    const grid = document.getElementById('gridChinchorros');
    const tbody = document.getElementById('tablaChinchorrosInv');
    if (!grid) return;

    refrescarPanelesOcupacionDual();

    aplicarLayoutsVistasInventarioDesdeHotel();

    const v = vistaInventarioNormalizada(datosHotelCache && datosHotelCache.vista_chinchorros);
    const vacioGrid =
        '<p style="text-align: center; color: #666; padding: 40px;">No hay chinchorros. Registra uno para alquilar.</p>';
    const vacioTabla =
        '<tr><td colspan="6" style="text-align: center; padding: 24px; color: #666;">No hay chinchorros registrados.</td></tr>';

    if (chinchorros.length === 0) {
        grid.innerHTML = vacioGrid;
        if (tbody) tbody.innerHTML = vacioTabla;
        return;
    }

    const listaChinchorros = chinchorrosFiltrados();
    if (listaChinchorros.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #666; padding: 30px;">Sin resultados para la búsqueda actual.</p>';
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }

    if (v === 'tabla') {
        grid.innerHTML = '';
        if (tbody) {
            tbody.innerHTML = listaChinchorros
                .map((c) => {
                    return `
            <tr>
                <td><strong>${escapeHtmlCal(etiquetaChinchorro(c))}</strong></td>
                <td>${escapeHtmlCal(c.tipo || 'N/A')}</td>
                <td>${escapeHtmlCal(c.piso || '-')}</td>
                <td>${escapeHtmlCal(String(c.reservas_activas ?? 0))}</td>
                <td class="td-estado-inventario">${htmlEstadoChinchorroInventario(c)}</td>
                <td class="td-acciones-inventario">
                    <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarChinchorro(${c.id})">✏️ Modificar</button>
                    <button type="button" class="btn-danger btn-small" onclick="eliminarChinchorro(${c.id})">🗑️ Eliminar</button>
                </td>
            </tr>`;
                })
                .join('');
        }
        return;
    }

    if (tbody) tbody.innerHTML = '';
    grid.innerHTML = '';

    listaChinchorros.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'habitacion-card';
        card.innerHTML = `
            <div class="habitacion-header">
                <div class="habitacion-numero">${escapeHtmlCal(etiquetaChinchorro(c))}</div>
                ${htmlEstadoChinchorroInventario(c)}
            </div>
            <div class="habitacion-info">
                <p><strong>Tipo:</strong> ${escapeHtmlCal(c.tipo || 'N/A')}</p>
                <p><strong>Piso / nivel:</strong> ${escapeHtmlCal(c.piso || '-')}</p>
                <p><strong>Reservas activas (hoy):</strong> ${escapeHtmlCal(String(c.reservas_activas ?? 0))}</p>
            </div>
            <div class="habitacion-acciones">
                <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarChinchorro(${c.id})">✏️ Modificar</button>
                <button type="button" class="btn-danger btn-small" onclick="eliminarChinchorro(${c.id})">🗑️ Eliminar</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function mostrarModalChinchorro() {
    document.getElementById('formChinchorro').reset();
    document.getElementById('idChinchorroEdicion').value = '';
    document.getElementById('tituloModalChinchorro').textContent = 'Nuevo chinchorro';
    const hint = document.getElementById('mensajeAyudaModalChinchorro');
    if (hint) hint.hidden = true;
    const btn = document.getElementById('btnSubmitChinchorro');
    if (btn) btn.textContent = 'Guardar';
    document.getElementById('tipoChinchorro').value = 'Sencilla';
    document.getElementById('estadoChinchorro').value = 'Disponible';
    aplicarReglasSelectEstadoChinchorroModal(null);
    document.getElementById('modalChinchorro').classList.add('active');
}

function mostrarModalEditarChinchorro(id) {
    const c = chinchorros.find((x) => Number(x.id) === Number(id));
    if (!c) return;
    document.getElementById('idChinchorroEdicion').value = String(c.id);
    document.getElementById('nombreChinchorro').value = etiquetaChinchorro(c);
    document.getElementById('tipoChinchorro').value = c.tipo || 'Sencilla';
    document.getElementById('pisoChinchorro').value = c.piso != null ? String(c.piso) : '';
    document.getElementById('estadoChinchorro').value = c.estado || 'Disponible';
    aplicarReglasSelectEstadoChinchorroModal(c);
    document.getElementById('tituloModalChinchorro').textContent = 'Modificar chinchorro';
    const hint = document.getElementById('mensajeAyudaModalChinchorro');
    if (hint) {
        hint.hidden = false;
        hint.innerHTML =
            'Puede cambiar nombre, tipo, piso y estado. Elija <strong>En limpieza</strong> o <strong>Fuera de servicio</strong> cuando corresponda. Ocupada y Reservada las asigna el sistema con las reservas. La tarifa por día se define en <strong>Reservas</strong>.';
    }
    const btn = document.getElementById('btnSubmitChinchorro');
    if (btn) btn.textContent = 'Guardar cambios';
    document.getElementById('modalChinchorro').classList.add('active');
}

async function guardarChinchorro(event) {
    event.preventDefault();
    const idEd = document.getElementById('idChinchorroEdicion').value.trim();
    const nombre = document.getElementById('nombreChinchorro').value.trim();
    const tipo = document.getElementById('tipoChinchorro').value.trim();
    const piso = document.getElementById('pisoChinchorro').value.trim();
    const estado = document.getElementById('estadoChinchorro').value;
    if (!nombre) {
        alert('El nombre del chinchorro es obligatorio');
        return;
    }
    try {
        let response;
        if (idEd) {
            response = await fetchWithAuth(`${API_URL}/chinchorros/${parseInt(idEd, 10)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, tipo, piso, estado })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/chinchorros`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, tipo, piso, estado })
            });
        }
        if (response.ok) {
            cerrarModal('modalChinchorro');
            cargarChinchorros();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al guardar el chinchorro');
        console.error(error);
    }
}

async function eliminarChinchorro(id) {
    if (!confirm('¿Eliminar este chinchorro y sus reservas asociadas?')) {
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/chinchorros/${id}`, { method: 'DELETE' });
        if (response.ok) {
            cargarChinchorros();
            cargarReservasChinchorros();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al eliminar');
        console.error(error);
    }
}

async function cargarReservasChinchorros() {
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas-chinchorros`);
        reservasChinchorros = await response.json();
        renderModuloReservas();
        refrescarPanelesOcupacionDual();
        actualizarAlertasSalidasHoy();
        renderGestionOperativa();
    } catch (error) {
        console.error('Error al cargar reservas de chinchorros:', error);
    }
}

function mostrarReservasChinchorros() {
    if (document.getElementById('tablaReservasUnificada')) {
        renderTablaReservasUnificada();
        return;
    }
    const tbody = document.getElementById('tablaReservasChinchorros');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (reservasChinchorros.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 24px; color: #666;">No hay reservas de chinchorros.</td></tr>';
        return;
    }
    const lista = reservasChinchorrosFiltradas();
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 24px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }
    lista.forEach((r) => {
        const row = document.createElement('tr');
        const fi = new Date(r.fecha_ingreso).toLocaleDateString('es-ES');
        const fs = new Date(r.fecha_salida).toLocaleDateString('es-ES');
        const estadoClass = r.estado === 'Activa' ? 'estado-disponible' : 'estado-ocupada';
        row.innerHTML = `
            <td>${r.id}</td>
            <td><strong>${escapeHtmlCal(etiquetaChinchorroReserva(r))}</strong></td>
            <td>${r.huesped_nombre} ${r.huesped_apellido || ''}</td>
            <td>${Number(r.adultos || 1)} / ${Number(r.ninos || 0)}</td>
            <td>${r.tipo_requerido || '-'}</td>
            <td>${r.metodo_pago || '-'}</td>
            <td>${fi}</td>
            <td>${fs}</td>
            <td><span class="estado-badge ${estadoClass}">${r.estado}</span></td>
            <td>${escapeHtmlCal(formatoMoneda(Number(r.chinchorro_precio_diario) || 0))}</td>
            <td>${textoValorReservaChinchorro(r)}</td>
            <td>${htmlCeldaPagoReserva(r, valorMonetarioReservaChinchorro, saldoReservaChinchorro)}</td>
            <td>${htmlCeldaSaldoReserva(r, saldoReservaChinchorro)}</td>
            <td>${r.observaciones || '-'}</td>
            ${htmlAccionesReservaChinchorro(r)}
        `;
        tbody.appendChild(row);
    });
}

function actualizarSelectsReservaChinchorro() {
    const selC = document.getElementById('chinchorroReserva');
    const selH = document.getElementById('huespedReservaChin');
    if (selC) {
        selC.innerHTML = '<option value="">Seleccionar</option>';
        chinchorros.forEach((c) => {
            if (!inventarioPermiteNuevaReserva(c.estado)) return;
            const o = document.createElement('option');
            o.value = c.id;
            o.textContent = `${etiquetaChinchorro(c)} · ${c.estado || ''}`;
            selC.appendChild(o);
        });
    }
}

function mostrarModalElegirTipoReserva() {
    const modal = document.getElementById('modalElegirTipoReserva');
    if (modal) modal.classList.add('active');
}

function elegirTipoReserva(tipo) {
    cerrarModal('modalElegirTipoReserva');
    const pend = calendarioReservaPendiente;
    calendarioReservaPendiente = null;
    if (pend && pend.ingreso) {
        if (tipo === 'habitacion') {
            abrirReservaHabitacionDesdeCalendario(null, pend.ingreso);
        } else if (tipo === 'chinchorro') {
            abrirReservaChinchorroDesdeCalendario(null, pend.ingreso);
        }
        return;
    }
    if (tipo === 'habitacion') {
        mostrarModalReserva();
    } else if (tipo === 'chinchorro') {
        mostrarModalReservaChinchorro();
    }
}

async function mostrarModalReservaChinchorro() {
    await asegurarHuespedesParaReserva();
    document.getElementById('formReservaChinchorro').reset();
    document.getElementById('idReservaChinchorroEdicion').value = '';
    document.getElementById('reservaChinAdultos').value = '1';
    document.getElementById('reservaChinNinos').value = '0';
    document.getElementById('metodoPagoReservaChin').value = 'Efectivo';
    document.getElementById('tarifaDiaReservaChin').value = '0';
    document.getElementById('abonoInicialReservaChin').value = '';
    document.getElementById('observacionesReservaChin').value = '';
    establecerModoModalReservaChin(false);
    const titulo = document.getElementById('tituloModalReservaChin');
    if (titulo) titulo.textContent = 'Reservar chinchorro';
    actualizarSelectsReservaChinchorro();
    limpiarComboboxHuesped('huespedReservaChin');
    const hoy = fechaLocalYMD();
    const fi = document.getElementById('fechaIngresoChin');
    const fs = document.getElementById('fechaSalidaChin');
    if (fi) fi.min = hoy;
    if (fs) {
        fs.min = fi && fi.value ? fi.value : hoy;
    }
    document.getElementById('modalReservaChinchorro').classList.add('active');
}

async function modificarReservaChinchorro(id) {
    await asegurarHuespedesParaReserva();
    const r = reservasChinchorros.find((x) => Number(x.id) === Number(id));
    if (!r) {
        alert('No se encontró la reserva.');
        return;
    }
    const tabBtn = document.getElementById('tabBtnReservas');
    if (tabBtn) {
        mostrarSeccion('reservas', tabBtn);
    }
    document.getElementById('idReservaChinchorroEdicion').value = String(r.id);
    const titulo = document.getElementById('tituloModalReservaChin');
    if (titulo) titulo.textContent = 'Modificar reserva de chinchorro';
    establecerModoModalReservaChin(true);
    actualizarSelectsReservaChinchorro();
    requestAnimationFrame(() => {
        const selCh = document.getElementById('chinchorroReserva');
        const labelCh =
            (r.chinchorro_nombre && String(r.chinchorro_nombre).trim()) ||
            (r.chinchorro_codigo && String(r.chinchorro_codigo).trim()) ||
            `Chinchorro #${r.chinchorro_id}`;
        asegurarOpcionEnSelect(selCh, r.chinchorro_id, labelCh);
        const labelHue = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim();
        establecerComboboxHuesped('huespedReservaChin', r.huesped_id, labelHue || undefined);
        document.getElementById('reservaChinAdultos').value = String(Number(r.adultos || 1));
        document.getElementById('reservaChinNinos').value = String(Number(r.ninos || 0));
        document.getElementById('tipoRequeridoChin').value = r.tipo_requerido || '';
        document.getElementById('metodoPagoReservaChin').value = r.metodo_pago || 'Efectivo';
        const tarifa =
            r.reserva_tarifa_dia != null && Number(r.reserva_tarifa_dia) > 0
                ? Number(r.reserva_tarifa_dia)
                : Number(r.chinchorro_precio_diario) || 0;
        document.getElementById('tarifaDiaReservaChin').value = String(tarifa);
        document.getElementById('observacionesReservaChin').value = r.observaciones || '';
        const fi = String(r.fecha_ingreso).slice(0, 10);
        const fs = String(r.fecha_salida).slice(0, 10);
        const fiEl = document.getElementById('fechaIngresoChin');
        const fsEl = document.getElementById('fechaSalidaChin');
        if (fiEl) {
            fiEl.removeAttribute('min');
            fiEl.value = fi;
        }
        if (fsEl) {
            fsEl.removeAttribute('min');
            fsEl.value = fs;
            fsEl.min = fi;
        }
        document.getElementById('modalReservaChinchorro').classList.add('active');
    });
}

async function guardarReservaChinchorro(event) {
    event.preventDefault();
    const idEd = document.getElementById('idReservaChinchorroEdicion').value.trim();
    const chinchorro_id = parseInt(document.getElementById('chinchorroReserva').value, 10);
    const huesped_id = parseInt(document.getElementById('huespedReservaChin').value, 10);
    const adultos = Math.max(1, parseInt(document.getElementById('reservaChinAdultos').value, 10) || 1);
    const ninos = Math.max(0, parseInt(document.getElementById('reservaChinNinos').value, 10) || 0);
    const tipo_requerido = document.getElementById('tipoRequeridoChin').value.trim();
    const metodo_pago = document.getElementById('metodoPagoReservaChin').value;
    const observaciones = document.getElementById('observacionesReservaChin').value.trim();
    const fecha_ingreso = document.getElementById('fechaIngresoChin').value;
    const fecha_salida = document.getElementById('fechaSalidaChin').value;
    const tarifaRaw = document.getElementById('tarifaDiaReservaChin').value;
    const tarifa_dia =
        tarifaRaw === '' || tarifaRaw == null ? 0 : Math.max(0, parseFloat(tarifaRaw) || 0);
    const abonoRawCh = document.getElementById('abonoInicialReservaChin').value;
    const monto_abonado =
        abonoRawCh === '' || abonoRawCh == null ? 0 : Math.max(0, parseFloat(abonoRawCh) || 0);
    if (!Number.isFinite(chinchorro_id)) {
        alert('Seleccione un chinchorro');
        return;
    }
    const chSel = chinchorros.find((x) => Number(x.id) === chinchorro_id);
    const idReservaChActual = idEd ? parseInt(idEd, 10) : null;
    const reservaChActual =
        idReservaChActual != null
            ? reservasChinchorros.find((x) => Number(x.id) === idReservaChActual)
            : null;
    const mismoChinchorro =
        reservaChActual && Number(reservaChActual.chinchorro_id) === chinchorro_id;
    if (chSel && !inventarioPermiteNuevaReserva(chSel.estado) && !mismoChinchorro) {
        alert(mensajeInventarioNoReservableUI(chSel.estado, 'chinchorro'));
        return;
    }
    if (!Number.isFinite(huesped_id)) {
        alert('Busque y seleccione un huésped de la lista');
        return;
    }
    if (tarifa_dia <= 0) {
        alert('Indique la tarifa por día de la reserva');
        return;
    }
    if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
        alert('La fecha de fin debe ser posterior al inicio');
        return;
    }
    const totalEstCh = !idEd ? totalEstimadoNuevaReserva(tarifa_dia, fecha_ingreso, fecha_salida) : 0;
    let montoAbonoEnviarCh = monto_abonado;
    if (!idEd && monto_abonado > 0 && totalEstCh > 0 && monto_abonado > totalEstCh + 0.005) {
        if (!confirm(
            `El abono (${formatoMoneda(monto_abonado)}) supera el total (${formatoMoneda(totalEstCh)}). ` +
            'Se registrará como pago completo. ¿Crear la reserva?'
        )) {
            return;
        }
        montoAbonoEnviarCh = totalEstCh;
    }
    try {
        let response;
        if (idEd) {
            response = await fetchWithAuth(`${API_URL}/reservas-chinchorros/${parseInt(idEd, 10)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_dia })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/reservas-chinchorros`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chinchorro_id, huesped_id, adultos, ninos, tipo_requerido, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_dia, monto_abonado: montoAbonoEnviarCh })
            });
        }
        if (response.ok) {
            cerrarModal('modalReservaChinchorro');
            cargarReservasChinchorros();
            cargarChinchorros();
            actualizarCalendarioDisponibilidad();
            if (!idEd && totalEstCh > 0 && montoAbonoEnviarCh >= totalEstCh - 0.005) {
                alert('Reserva creada correctamente. Pago completo registrado.');
            } else if (!idEd && montoAbonoEnviarCh > 0) {
                alert(`Reserva creada correctamente. Abono inicial: ${formatoMoneda(montoAbonoEnviarCh)}.`);
            }
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo guardar.');
            alert('Error: ' + msg);
        }
    } catch (error) {
        alert('Error al reservar chinchorro');
        console.error(error);
    }
}

async function cancelarReservaChinchorro(id) {
    if (!confirm('¿Cancelar esta reserva de chinchorro?')) return;
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas-chinchorros/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Cancelada' })
        });
        if (response.ok) {
            cargarReservasChinchorros();
            cargarChinchorros();
            actualizarCalendarioDisponibilidad();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al cancelar');
        console.error(error);
    }
}

async function eliminarReservaChinchorro(id) {
    if (!confirm('¿Eliminar esta reserva de chinchorro?')) return;
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas-chinchorros/${id}`, { method: 'DELETE' });
        if (response.ok) {
            cargarReservasChinchorros();
            cargarChinchorros();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al eliminar');
        console.error(error);
    }
}

// ========== FUNCIONES DE CAMAS ==========
async function gestionarCamas(habitacionId, numeroHabitacion) {
    habitacionActualId = habitacionId;
    document.getElementById('numeroHabitacionCamas').textContent = numeroHabitacion;
    document.getElementById('modalCamas').classList.add('active');
    cargarCamas(habitacionId);
}

async function cargarCamas(habitacionId) {
    try {
        const response = await fetchWithAuth(`${API_URL}/habitaciones/${habitacionId}/camas`);
        const camas = await response.json();
        mostrarCamas(camas);
    } catch (error) {
        console.error('Error al cargar camas:', error);
    }
}

function mostrarCamas(camas) {
    const lista = document.getElementById('listaCamas');
    lista.innerHTML = '';
    
    if (camas.length === 0) {
        lista.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No hay camas registradas en esta habitación.</p>';
        return;
    }
    
    camas.forEach(cama => {
        const item = document.createElement('div');
        item.className = 'cama-item';
        item.innerHTML = `
            <div class="cama-info">
                <div class="cama-tipo">${cama.tipo}</div>
                ${cama.numero ? `<div class="cama-numero">Cama #${cama.numero}</div>` : ''}
            </div>
            <button class="btn-danger btn-small" onclick="eliminarCama(${cama.id})">🗑️</button>
        `;
        lista.appendChild(item);
    });
}

async function agregarCama() {
    const tipo = document.getElementById('tipoCama').value;
    const numero = document.getElementById('numeroCama').value;
    
    try {
        const response = await fetchWithAuth(`${API_URL}/habitaciones/${habitacionActualId}/camas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo, numero: numero || null })
        });
        
        if (response.ok) {
            document.getElementById('numeroCama').value = '';
            cargarCamas(habitacionActualId);
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al agregar la cama');
        console.error(error);
    }
}

async function eliminarCama(id) {
    if (!confirm('¿Estás seguro de eliminar esta cama?')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_URL}/camas/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            cargarCamas(habitacionActualId);
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al eliminar la cama');
        console.error(error);
    }
}

// ========== FUNCIONES DE HUÉSPEDES ==========
async function cargarHuespedes() {
    try {
        const response = await fetchWithAuth(`${API_URL}/huespedes`);
        huespedes = await response.json();
        mostrarHuespedes();
    } catch (error) {
        console.error('Error al cargar huéspedes:', error);
    }
}

function mostrarHuespedes() {
    const tbody = document.getElementById('tablaHuespedes');
    tbody.innerHTML = '';
    
    if (huespedes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #666;">No hay huéspedes registrados.</td></tr>';
        return;
    }

    const lista = huespedesFiltrados();
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }

    lista.forEach(huesped => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${huesped.id}</td>
            <td>${huesped.nombre}</td>
            <td>${huesped.apellido || '-'}</td>
            <td>${huesped.email || '-'}</td>
            <td>${huesped.telefono || '-'}</td>
            <td>${huesped.tipo_documento || '-'}</td>
            <td>${huesped.documento || '-'}</td>
            <td>
                <button type="button" class="btn-secondary btn-small" onclick="modificarHuesped(${huesped.id})">✏️ Modificar</button>
                <button type="button" class="btn-danger btn-small" onclick="eliminarHuesped(${huesped.id})">🗑️ Eliminar</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function mostrarModalHuesped() {
    document.getElementById('formHuesped').reset();
    document.getElementById('idHuespedEdicion').value = '';
    document.getElementById('tituloModalHuesped').textContent = 'Nuevo Huésped';
    const btn = document.getElementById('btnSubmitHuesped');
    if (btn) btn.textContent = 'Guardar';
    document.getElementById('modalHuesped').classList.add('active');
}

function modificarHuesped(id) {
    const h = huespedes.find((x) => Number(x.id) === Number(id));
    if (!h) return;
    const form = document.getElementById('formHuesped');
    if (form) {
        form.reset();
    }
    document.getElementById('idHuespedEdicion').value = String(h.id);
    document.getElementById('nombreHuesped').value = h.nombre || '';
    document.getElementById('apellidoHuesped').value = h.apellido || '';
    document.getElementById('emailHuesped').value = h.email || '';
    document.getElementById('telefonoHuesped').value = h.telefono || '';
    document.getElementById('tipoDocumentoHuesped').value = h.tipo_documento || 'Cédula';
    document.getElementById('documentoHuesped').value = h.documento || '';
    document.getElementById('tituloModalHuesped').textContent = 'Modificar huésped';
    const btn = document.getElementById('btnSubmitHuesped');
    if (btn) btn.textContent = 'Actualizar';
    document.getElementById('modalHuesped').classList.add('active');
}

function emailHuespedValido(val) {
    const v = (val || '').trim();
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function guardarHuesped(event) {
    event.preventDefault();
    const idEdicion = document.getElementById('idHuespedEdicion').value.trim();
    const nombre = document.getElementById('nombreHuesped').value.trim();
    const apellido = document.getElementById('apellidoHuesped').value.trim();
    const email = document.getElementById('emailHuesped').value.trim();
    const telefono = document.getElementById('telefonoHuesped').value.trim();
    const tipo_documento = document.getElementById('tipoDocumentoHuesped').value.trim();
    const documento = document.getElementById('documentoHuesped').value.trim();

    if (!nombre) {
        alert('El nombre es obligatorio');
        return;
    }
    if (!emailHuespedValido(email)) {
        alert('El email no tiene un formato válido (o déjelo vacío)');
        return;
    }

    const idNum = idEdicion ? parseInt(idEdicion, 10) : NaN;
    if (idEdicion && (!Number.isFinite(idNum) || idNum < 1)) {
        alert('Identificador de huésped no válido. Cierre el modal y vuelva a abrir «Modificar».');
        return;
    }

    try {
        let response;
        if (idEdicion) {
            response = await fetchWithAuth(`${API_URL}/huespedes/${idNum}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, apellido, email, telefono, tipo_documento, documento })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/huespedes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, apellido, email, telefono, tipo_documento, documento })
            });
        }

        if (response.ok) {
            cerrarModal('modalHuesped');
            cargarHuespedes();
            cargarReservas();
            cargarReservasChinchorros();
        } else {
            let msg = `Error ${response.status}`;
            try {
                const ct = response.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    const error = await response.json();
                    if (error.error) msg = error.error;
                } else {
                    const t = await response.text();
                    if (t) msg = t.slice(0, 200);
                }
            } catch (_) { /* ignore */ }
            alert('Error: ' + msg);
        }
    } catch (error) {
        const detalle = error && error.message ? error.message : String(error);
        alert((idEdicion ? 'Error al actualizar' : 'Error al crear') + ' el huésped: ' + detalle);
        console.error(error);
    }
}

async function eliminarHuesped(id) {
    if (!confirm('¿Estás seguro de eliminar este huésped? Esto también eliminará todas sus reservas.')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_URL}/huespedes/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            cargarHuespedes();
            cargarReservas();
            cargarReservasChinchorros();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al eliminar el huésped');
        console.error(error);
    }
}

// ========== FUNCIONES DE RESERVAS ==========

/** Solo para «Nueva reserva»: no permite fechas pasadas. */
function aplicarFechasMinNuevaReservaHabitacion() {
    const hoy = fechaLocalYMD();
    const fechaIngresoInput = document.getElementById('fechaIngreso');
    const fechaSalidaInput = document.getElementById('fechaSalida');
    if (fechaIngresoInput) {
        fechaIngresoInput.min = hoy;
    }
    if (fechaSalidaInput) {
        const fi = fechaIngresoInput && fechaIngresoInput.value ? fechaIngresoInput.value : hoy;
        fechaSalidaInput.min = fi;
    }
}

function liberarFechasReservaHabitacion() {
    const fechaIngresoInput = document.getElementById('fechaIngreso');
    const fechaSalidaInput = document.getElementById('fechaSalida');
    if (fechaIngresoInput) {
        fechaIngresoInput.removeAttribute('min');
    }
    if (fechaSalidaInput) {
        fechaSalidaInput.removeAttribute('min');
    }
}

async function cargarReservas() {
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas`);
        reservas = await response.json();
        renderModuloReservas();
        mostrarHabitaciones();
        actualizarSelectsReserva();
        refrescarPanelesOcupacionDual();
        actualizarAlertasSalidasHoy();
        renderGestionOperativa();
    } catch (error) {
        console.error('Error al cargar reservas:', error);
    }
}

function mostrarReservas(tbodyId = 'tablaReservas') {
    if (document.getElementById('tablaReservasUnificada')) {
        renderModuloReservas();
        return;
    }
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (reservas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 40px; color: #666;">No hay reservas registradas.</td></tr>';
        return;
    }

    const lista = reservasHabitacionesFiltradas();
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 40px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }

    lista.forEach(reserva => {
        const row = document.createElement('tr');
        const fechaIngreso = new Date(reserva.fecha_ingreso).toLocaleDateString('es-ES');
        const fechaSalida = new Date(reserva.fecha_salida).toLocaleDateString('es-ES');
        const estadoClass = claseEstadoReservaHabitacion(reserva.estado);
        
        row.innerHTML = `
            <td>${reserva.id}</td>
            <td><strong>${escapeHtmlCal(etiquetaHabitacionReserva(reserva))}</strong></td>
            <td>${reserva.huesped_nombre} ${reserva.huesped_apellido || ''}</td>
            <td>${Number(reserva.adultos || 1)} / ${Number(reserva.ninos || 0)}</td>
            <td>${reserva.tipo_habitacion_requerida || '-'}</td>
            <td>${reserva.metodo_pago || '-'}</td>
            <td>${fechaIngreso}</td>
            <td>${fechaSalida}</td>
            <td><span class="estado-badge ${estadoClass}">${escapeHtmlCal(reserva.estado)}</span></td>
            <td>${escapeHtmlCal(formatoMoneda(Number(reserva.habitacion_precio_diario) || 0))}</td>
            <td>${textoValorReservaHabitacion(reserva)}</td>
            <td>${htmlCeldaPagoReserva(reserva, valorMonetarioReservaHabitacion, saldoReservaHabitacion)}</td>
            <td>${htmlCeldaSaldoReserva(reserva, saldoReservaHabitacion)}</td>
            <td>${reserva.observaciones || '-'}</td>
            ${htmlAccionesReservaHabitacion(reserva)}
        `;
        tbody.appendChild(row);
    });
}

function actualizarSelectsReserva() {
    const selectHabitacion = document.getElementById('habitacionReserva');
    if (!selectHabitacion) return;
    selectHabitacion.innerHTML = '<option value="">Seleccionar habitación</option>';
    habitaciones.forEach((hab) => {
        if (!inventarioPermiteNuevaReserva(hab.estado)) return;
        const option = document.createElement('option');
        option.value = hab.id;
        option.textContent = `${etiquetaHabitacion(hab)} · ${hab.estado || ''}`;
        selectHabitacion.appendChild(option);
    });
}

/** Asegura que exista la opción antes de asignar value (evita selects vacíos tras repoblar). */
function establecerTipoHabitacionRequerida(valor) {
    const sel = document.getElementById('tipoHabitacionRequerida');
    if (!sel) return;
    const v = valor != null ? String(valor).trim() : '';
    if (v && !Array.from(sel.options).some((o) => o.value === v)) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
    }
    sel.value = v;
}

function asegurarOpcionEnSelect(selectEl, valor, textoMostrar) {
    if (!selectEl || valor === undefined || valor === null) {
        return;
    }
    const v = String(valor);
    const exists = Array.from(selectEl.options).some((o) => o.value === v);
    if (!exists) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = textoMostrar && String(textoMostrar).trim() ? textoMostrar.trim() : `(id ${v})`;
        selectEl.appendChild(o);
    }
    selectEl.value = v;
}

function establecerModoModalReserva(esEdicion) {
    const hint = document.getElementById('mensajeAyudaModalReserva');
    const btn = document.getElementById('btnSubmitReserva');
    const grupoAbono = document.getElementById('grupoAbonoInicialReserva');
    if (hint) {
        hint.hidden = !esEdicion;
    }
    if (btn) {
        btn.textContent = esEdicion ? '💾 Guardar cambios' : 'Reservar';
    }
    if (grupoAbono) {
        grupoAbono.hidden = esEdicion;
    }
}

function establecerModoModalReservaChin(esEdicion) {
    const grupoAbono = document.getElementById('grupoAbonoInicialReservaChin');
    if (grupoAbono) {
        grupoAbono.hidden = esEdicion;
    }
}

async function mostrarModalReserva() {
    await asegurarHuespedesParaReserva();
    document.getElementById('formReserva').reset();
    document.getElementById('idReservaEdicion').value = '';
    document.getElementById('tituloModalReserva').textContent = 'Nueva Reserva';
    document.getElementById('reservaAdultos').value = '1';
    document.getElementById('reservaNinos').value = '0';
    document.getElementById('metodoPagoReserva').value = 'Efectivo';
    document.getElementById('tarifaNocheReserva').value = '0';
    document.getElementById('abonoInicialReserva').value = '';
    document.getElementById('observacionesReserva').value = '';
    establecerModoModalReserva(false);
    actualizarSelectsReserva();
    aplicarFechasMinNuevaReservaHabitacion();
    document.getElementById('modalReserva').classList.add('active');
}

async function modificarReserva(id) {
    await asegurarHuespedesParaReserva();
    const r = reservas.find((x) => Number(x.id) === Number(id));
    if (!r) {
        alert('No se encontró esa reserva en la lista. Abra la pestaña Reservas o recargue la página.');
        return;
    }
    const tabBtn = document.getElementById('tabBtnReservas');
    if (tabBtn) {
        mostrarSeccion('reservas', tabBtn);
    }

    document.getElementById('tituloModalReserva').textContent = 'Modificar reserva';
    establecerModoModalReserva(true);

    actualizarSelectsReserva();
    liberarFechasReservaHabitacion();

    const aplicarValoresModalEdicion = () => {
        document.getElementById('idReservaEdicion').value = String(r.id);
        const selHab = document.getElementById('habitacionReserva');
        const labelHab =
            (r.habitacion_nombre && String(r.habitacion_nombre).trim()) ||
            (r.habitacion_numero != null ? `Habitación ${r.habitacion_numero}` : null);
        const labelHue = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim();
        asegurarOpcionEnSelect(selHab, r.habitacion_id, labelHab);
        establecerComboboxHuesped('huespedReserva', r.huesped_id, labelHue || undefined);
        document.getElementById('reservaAdultos').value = String(Number(r.adultos || 1));
        document.getElementById('reservaNinos').value = String(Number(r.ninos || 0));
        establecerTipoHabitacionRequerida(r.tipo_habitacion_requerida);
        document.getElementById('metodoPagoReserva').value = r.metodo_pago || 'Efectivo';
        const tarifa =
            r.reserva_tarifa_noche != null && Number(r.reserva_tarifa_noche) > 0
                ? Number(r.reserva_tarifa_noche)
                : Number(r.habitacion_precio_diario) || 0;
        document.getElementById('tarifaNocheReserva').value = String(tarifa);
        document.getElementById('observacionesReserva').value = r.observaciones || '';
        const fi = String(r.fecha_ingreso).slice(0, 10);
        const fs = String(r.fecha_salida).slice(0, 10);
        document.getElementById('fechaIngreso').value = fi;
        document.getElementById('fechaSalida').value = fs;
        const fechaSalidaInput = document.getElementById('fechaSalida');
        if (fechaSalidaInput) {
            fechaSalidaInput.min = fi;
        }
        document.getElementById('modalReserva').classList.add('active');
    };

    requestAnimationFrame(() => {
        aplicarValoresModalEdicion();
    });
}

async function guardarReserva(event) {
    event.preventDefault();
    const idEdicion = document.getElementById('idReservaEdicion').value.trim();
    const habitacion_id = parseInt(document.getElementById('habitacionReserva').value, 10);
    const huesped_id = parseInt(document.getElementById('huespedReserva').value, 10);
    const adultos = Math.max(1, parseInt(document.getElementById('reservaAdultos').value, 10) || 1);
    const ninos = Math.max(0, parseInt(document.getElementById('reservaNinos').value, 10) || 0);
    const tipo_habitacion_requerida = document.getElementById('tipoHabitacionRequerida').value.trim();
    const metodo_pago = document.getElementById('metodoPagoReserva').value;
    const observaciones = document.getElementById('observacionesReserva').value.trim();
    const fecha_ingreso = document.getElementById('fechaIngreso').value;
    const fecha_salida = document.getElementById('fechaSalida').value;
    const tarifaRaw = document.getElementById('tarifaNocheReserva').value;
    const tarifa_noche =
        tarifaRaw === '' || tarifaRaw == null ? 0 : Math.max(0, parseFloat(tarifaRaw) || 0);
    const abonoRaw = document.getElementById('abonoInicialReserva').value;
    const monto_abonado =
        abonoRaw === '' || abonoRaw == null ? 0 : Math.max(0, parseFloat(abonoRaw) || 0);

    if (!Number.isFinite(habitacion_id)) {
        alert('Seleccione una habitación');
        return;
    }
    const habSel = habitaciones.find((x) => Number(x.id) === habitacion_id);
    const idReservaActual = idEdicion ? parseInt(idEdicion, 10) : null;
    const reservaActual =
        idReservaActual != null ? reservas.find((x) => Number(x.id) === idReservaActual) : null;
    const mismaHabitacion =
        reservaActual && Number(reservaActual.habitacion_id) === habitacion_id;
    if (habSel && !inventarioPermiteNuevaReserva(habSel.estado) && !mismaHabitacion) {
        alert(mensajeInventarioNoReservableUI(habSel.estado, 'habitacion'));
        return;
    }
    if (!Number.isFinite(huesped_id)) {
        alert('Busque y seleccione un huésped de la lista');
        return;
    }

    if (tarifa_noche <= 0) {
        alert('Indique la tarifa por noche de la reserva');
        return;
    }

    if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
        alert('La fecha de salida debe ser posterior a la fecha de ingreso');
        return;
    }

    const totalEst = !idEdicion ? totalEstimadoNuevaReserva(tarifa_noche, fecha_ingreso, fecha_salida) : 0;
    let montoAbonoEnviar = monto_abonado;
    if (!idEdicion && monto_abonado > 0 && totalEst > 0 && monto_abonado > totalEst + 0.005) {
        if (!confirm(
            `El abono (${formatoMoneda(monto_abonado)}) supera el total (${formatoMoneda(totalEst)}). ` +
            'Se registrará como pago completo. ¿Crear la reserva?'
        )) {
            return;
        }
        montoAbonoEnviar = totalEst;
    }

    try {
        let response;
        if (idEdicion) {
            const idNum = parseInt(idEdicion, 10);
            response = await fetchWithAuth(`${API_URL}/reservas/${idNum}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_noche })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/reservas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ habitacion_id, huesped_id, adultos, ninos, tipo_habitacion_requerida, metodo_pago, observaciones, fecha_ingreso, fecha_salida, tarifa_noche, monto_abonado: montoAbonoEnviar })
            });
        }

        if (response.ok) {
            cerrarModal('modalReserva');
            cargarReservas();
            cargarHabitaciones();
            actualizarCalendarioDisponibilidad();
            if (idEdicion) {
                alert('Cambios guardados correctamente.');
            } else if (totalEst > 0 && montoAbonoEnviar >= totalEst - 0.005) {
                alert('Reserva creada correctamente. Pago completo registrado.');
            } else if (montoAbonoEnviar > 0) {
                alert(`Reserva creada correctamente. Abono inicial: ${formatoMoneda(montoAbonoEnviar)}.`);
            }
        } else {
            const fallback = idEdicion ? 'No se pudo actualizar la reserva.' : 'No se pudo crear la reserva.';
            const msg = await mensajeErrorRespuestaFetch(response, fallback);
            alert('Error: ' + msg);
        }
    } catch (error) {
        alert(idEdicion ? 'Error al actualizar la reserva' : 'Error al crear la reserva');
        console.error(error);
    }
}

let confirmarCheckinResolver = null;

function preguntarConfirmarLlegadaHuesped() {
    return new Promise((resolve) => {
        confirmarCheckinResolver = resolve;
        const modal = document.getElementById('modalConfirmarCheckin');
        const texto = document.getElementById('textoModalConfirmarCheckin');
        if (texto) {
            texto.textContent = '¿Desea confirmar la llegada del huésped?';
        }
        if (modal) modal.classList.add('active');
    });
}

function responderConfirmarCheckin(si) {
    const modal = document.getElementById('modalConfirmarCheckin');
    if (modal) modal.classList.remove('active');
    if (confirmarCheckinResolver) {
        confirmarCheckinResolver(!!si);
        confirmarCheckinResolver = null;
    }
}

async function confirmarCheckinReserva(id) {
    const confirmado = await preguntarConfirmarLlegadaHuesped();
    if (!confirmado) {
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas/${id}/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
            await cargarReservas();
            cargarHabitaciones();
            actualizarCalendarioDisponibilidad();
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo registrar el check-in.');
            alert('Error: ' + msg);
        }
    } catch (error) {
        alert('Error al registrar el check-in');
        console.error(error);
    }
}

async function finalizarReservaSalida(id) {
    if (!confirm('¿Confirmar que el huésped salió? La reserva pasará a finalizada y se actualizará el estado de la habitación si corresponde.')) {
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Finalizada' })
        });
        if (response.ok) {
            cargarReservas();
            cargarHabitaciones();
            actualizarCalendarioDisponibilidad();
        } else {
            const err = await response.json().catch(() => ({}));
            alert('Error: ' + (err.error || response.status));
        }
    } catch (error) {
        alert('Error al finalizar la reserva');
        console.error(error);
    }
}

async function finalizarReservaChinchorroSalida(id) {
    if (!confirm('¿Confirmar que el huésped devolvió el chinchorro? La reserva quedará finalizada.')) {
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas-chinchorros/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Finalizada' })
        });
        if (response.ok) {
            cargarReservasChinchorros();
            cargarChinchorros();
            actualizarCalendarioDisponibilidad();
        } else {
            const err = await response.json().catch(() => ({}));
            alert('Error: ' + (err.error || response.status));
        }
    } catch (error) {
        alert('Error al finalizar la reserva');
        console.error(error);
    }
}

async function cancelarReserva(id) {
    if (!confirm('¿Estás seguro de cancelar esta reserva?')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Cancelada' })
        });
        
        if (response.ok) {
            cargarReservas();
            cargarHabitaciones();
            actualizarCalendarioDisponibilidad();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al cancelar la reserva');
        console.error(error);
    }
}

async function eliminarReserva(id) {
    if (!confirm('¿Estás seguro de eliminar esta reserva?')) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_URL}/reservas/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            cargarReservas();
            cargarHabitaciones();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al eliminar la reserva');
        console.error(error);
    }
}

// ========== ADMINISTRACIÓN DE USUARIOS Y MI CONTRASEÑA ==========
function cuentaUsuarioActiva(activo) {
    return !(activo === 0 || activo === '0' || activo === false);
}

function textoEstadoCuentaUsuario(activo) {
    return cuentaUsuarioActiva(activo) ? 'Activa' : 'Anulada';
}

function claseEstadoCuentaUsuario(activo) {
    return cuentaUsuarioActiva(activo) ? 'estado-disponible' : 'estado-ocupada';
}

function actualizarPanelEstadoUsuarioEdicion(u) {
    const panel = document.getElementById('editUsuarioEstadoPanel');
    const texto = document.getElementById('editUsuarioEstadoTexto');
    const btnAnular = document.getElementById('btnAnularUsuarioEdit');
    const btnReactivar = document.getElementById('btnReactivarUsuarioEdit');
    if (!panel || !u) return;

    const activa = cuentaUsuarioActiva(u.activo);
    const esSelf = usuarioActual && Number(u.id) === Number(usuarioActual.id);

    if (texto) {
        texto.textContent = activa
            ? 'La cuenta puede iniciar sesión en el sistema.'
            : 'Cuenta anulada: no puede iniciar sesión.';
    }
    if (btnAnular) {
        btnAnular.hidden = !activa;
        btnAnular.disabled = esSelf;
        btnAnular.title = esSelf
            ? 'No puede anular su propia cuenta; use otro administrador.'
            : 'Impide el acceso sin borrar el usuario';
    }
    if (btnReactivar) {
        btnReactivar.hidden = activa;
    }
}

async function cargarUsuariosAdmin() {
    const tbody = document.getElementById('tablaUsuariosAdmin');
    if (!tbody) return;
    try {
        const response = await fetchWithAuth(`${API_URL}/usuarios`);
        listaUsuariosAdmin = await response.json();
        tbody.innerHTML = '';
        if (!listaUsuariosAdmin.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#666;">No hay usuarios.</td></tr>';
            return;
        }
        listaUsuariosAdmin.forEach((u) => {
            const row = document.createElement('tr');
            const activa = cuentaUsuarioActiva(u.activo);
            if (!activa) {
                row.classList.add('fila-usuario-anulado');
            }
            const rolClass = u.rol === 'administrador' ? 'estado-ocupada' : 'estado-disponible';
            const rolTxt = u.rol === 'administrador' ? 'Administrador' : 'Operador';
            const estadoClass = claseEstadoCuentaUsuario(u.activo);
            const estadoTxt = textoEstadoCuentaUsuario(u.activo);
            const ultimo = u.ultimo_acceso
                ? new Date(u.ultimo_acceso).toLocaleString('es-ES')
                : '—';
            const esSelf = usuarioActual && Number(u.id) === Number(usuarioActual.id);
            const btnAnular =
                activa && !esSelf
                    ? `<button type="button" class="btn-danger btn-small" onclick="toggleUsuarioActivo(${u.id}, false)">Anular</button>`
                    : activa && esSelf
                      ? `<button type="button" class="btn-danger btn-small" disabled title="Use otro administrador para anular su cuenta">Anular</button>`
                      : '';
            const btnReactivar = !activa
                ? `<button type="button" class="btn-primary btn-small" onclick="toggleUsuarioActivo(${u.id}, true)">Reactivar</button>`
                : '';
            row.innerHTML = `
                <td>${u.id}</td>
                <td><strong>${escapeHtmlCal(u.username)}</strong></td>
                <td>${escapeHtmlCal(u.nombre || '')}</td>
                <td>${escapeHtmlCal(u.email || '')}</td>
                <td><span class="estado-badge ${rolClass}">${rolTxt}</span></td>
                <td><span class="estado-badge ${estadoClass}">${estadoTxt}</span></td>
                <td>${ultimo}</td>
                <td class="td-acciones-inventario">
                    <button type="button" class="btn-secondary btn-small" onclick="abrirModalEditarUsuario(${u.id})">Editar</button>
                    <button type="button" class="btn-secondary btn-small" onclick="abrirModalResetPassword(${u.id})">Contraseña</button>
                    ${btnAnular}${btnReactivar}
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        console.error(e);
    }
}

function mostrarModalMiPassword() {
    document.getElementById('formMiPassword').reset();
    document.getElementById('modalMiPassword').classList.add('active');
}

async function guardarMiPassword(event) {
    event.preventDefault();
    const password_actual = document.getElementById('miPassActual').value;
    const password_nueva = document.getElementById('miPassNueva').value;
    const password_nueva2 = document.getElementById('miPassNueva2').value;
    if (password_nueva !== password_nueva2) {
        alert('Las contraseñas nuevas no coinciden');
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/auth/mi-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password_actual, password_nueva })
        });
        if (response.ok) {
            cerrarModal('modalMiPassword');
            alert('Contraseña actualizada correctamente');
        } else {
            const err = await response.json();
            alert('Error: ' + (err.error || 'No se pudo actualizar'));
        }
    } catch (error) {
        console.error(error);
    }
}

function mostrarModalNuevoUsuario() {
    document.getElementById('formNuevoUsuario').reset();
    document.getElementById('modalNuevoUsuario').classList.add('active');
}

async function guardarNuevoUsuario(event) {
    event.preventDefault();
    const username = document.getElementById('nuevoUsername').value.trim();
    const password = document.getElementById('nuevoPassword').value;
    const nombre = document.getElementById('nuevoNombre').value.trim();
    const email = document.getElementById('nuevoEmail').value.trim();
    const rol = document.getElementById('nuevoRol').value;
    try {
        const response = await fetchWithAuth(`${API_URL}/usuarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, nombre, email, rol })
        });
        if (response.ok) {
            cerrarModal('modalNuevoUsuario');
            const rolTxt = rol === 'administrador' ? 'Administrador' : 'Operador';
            alert(
                `Usuario «${username}» creado como ${rolTxt}.\n\n` +
                (rol === 'operador'
                    ? 'Los operadores pueden iniciar sesión con normalidad (habitaciones, reservas, huéspedes, chinchorros, calendario). Solo no administran usuarios ni colores.'
                    : 'Tiene acceso total al sistema, incluida la configuración.')
            );
            cargarUsuariosAdmin();
        } else {
            const err = await response.json();
            alert('Error: ' + (err.error || 'No se pudo crear'));
        }
    } catch (error) {
        console.error(error);
    }
}

function abrirModalEditarUsuario(id) {
    const u = listaUsuariosAdmin.find((x) => Number(x.id) === Number(id));
    if (!u) return;
    document.getElementById('editUsuarioId').value = u.id;
    document.getElementById('editUsernameReadonly').value = u.username;
    document.getElementById('editNombreUsuario').value = u.nombre || '';
    document.getElementById('editEmailUsuario').value = u.email || '';
    document.getElementById('editRolUsuario').value = u.rol === 'administrador' ? 'administrador' : 'operador';
    actualizarPanelEstadoUsuarioEdicion(u);
    document.getElementById('modalEditarUsuario').classList.add('active');
}

async function anularUsuarioDesdeEdicion() {
    const id = document.getElementById('editUsuarioId').value;
    if (!id) return;
    await toggleUsuarioActivo(parseInt(id, 10), false, true);
}

async function reactivarUsuarioDesdeEdicion() {
    const id = document.getElementById('editUsuarioId').value;
    if (!id) return;
    await toggleUsuarioActivo(parseInt(id, 10), true, true);
}

async function guardarEdicionUsuario(event) {
    event.preventDefault();
    const id = document.getElementById('editUsuarioId').value;
    const nombre = document.getElementById('editNombreUsuario').value.trim();
    const email = document.getElementById('editEmailUsuario').value.trim();
    const rol = document.getElementById('editRolUsuario').value;
    try {
        const response = await fetchWithAuth(`${API_URL}/usuarios/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, email, rol })
        });
        if (response.ok) {
            cerrarModal('modalEditarUsuario');
            await verificarAutenticacion();
            aplicarPermisosUI();
            cargarUsuariosAdmin();
        } else {
            const err = await response.json();
            alert('Error: ' + (err.error || 'No se pudo guardar'));
        }
    } catch (error) {
        console.error(error);
    }
}

function abrirModalResetPassword(id) {
    const u = listaUsuariosAdmin.find((x) => Number(x.id) === Number(id));
    if (!u) return;
    document.getElementById('resetPassUserId').value = u.id;
    document.getElementById('resetPassUsernameLabel').textContent = u.username;
    document.getElementById('resetPass1').value = '';
    document.getElementById('resetPass2').value = '';
    document.getElementById('modalResetPassword').classList.add('active');
}

async function guardarResetPasswordAdmin(event) {
    event.preventDefault();
    const id = document.getElementById('resetPassUserId').value;
    const p1 = document.getElementById('resetPass1').value;
    const p2 = document.getElementById('resetPass2').value;
    if (p1 !== p2) {
        alert('Las contraseñas no coinciden');
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_URL}/usuarios/${id}/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password_nueva: p1 })
        });
        if (response.ok) {
            cerrarModal('modalResetPassword');
            alert('Contraseña restablecida');
        } else {
            const err = await response.json();
            alert('Error: ' + (err.error || 'No se pudo restablecer'));
        }
    } catch (error) {
        console.error(error);
    }
}

async function toggleUsuarioActivo(id, activar, desdeEdicion = false) {
    const msg = activar
        ? '¿Reactivar esta cuenta? El usuario podrá volver a iniciar sesión.'
        : '¿Anular esta cuenta? El usuario no podrá iniciar sesión hasta que la reactive un administrador.';
    if (!confirm(msg)) return;
    try {
        const response = await fetchWithAuth(`${API_URL}/usuarios/${id}/activo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activo: activar ? 1 : 0 })
        });
        if (response.ok) {
            await cargarUsuariosAdmin();
            if (desdeEdicion) {
                const u = listaUsuariosAdmin.find((x) => Number(x.id) === Number(id));
                if (u) {
                    actualizarPanelEstadoUsuarioEdicion(u);
                }
            }
            alert(activar ? 'Cuenta reactivada correctamente.' : 'Cuenta anulada correctamente.');
        } else {
            const err = await response.json();
            alert('Error: ' + (err.error || 'No se pudo cambiar el estado'));
        }
    } catch (error) {
        if (error && error.message === 'Forbidden') return;
        console.error(error);
    }
}

function actualizarPreviewAbonoReserva() {
    const input = document.getElementById('montoAbonoReserva');
    const preview = document.getElementById('previewAbonoReserva');
    if (!input || !preview) return;
    const abonadoActual = parseFloat(input.dataset.abonadoActual) || 0;
    const saldoMax = parseFloat(input.dataset.saldoMax) || 0;
    const extra = parseFloat(input.value);
    if (!Number.isFinite(extra) || extra <= 0) {
        preview.textContent = 'Este valor se suma al abonado ya registrado.';
        return;
    }
    const nuevoAbonado = Math.min(abonadoActual + extra, abonadoActual + saldoMax);
    let texto = `Nuevo abonado: ${formatoMoneda(nuevoAbonado)} (${formatoMoneda(abonadoActual)} + ${formatoMoneda(extra)})`;
    if (extra > saldoMax + 0.005) {
        texto += `. El máximo adicional es ${formatoMoneda(saldoMax)}.`;
    }
    preview.textContent = texto;
}

function enlazarPreviewAbonoReserva() {
    if (window.__previewAbonoOk) return;
    window.__previewAbonoOk = true;
    const input = document.getElementById('montoAbonoReserva');
    if (input) {
        input.addEventListener('input', actualizarPreviewAbonoReserva);
    }
}

function abrirModalAbonoReserva(tipo, id) {
    enlazarPreviewAbonoReserva();
    const esChin = tipo === 'chinchorro';
    const r = esChin
        ? reservasChinchorros.find((x) => Number(x.id) === Number(id))
        : reservas.find((x) => Number(x.id) === Number(id));
    if (!r) {
        alert('No se encontró la reserva.');
        return;
    }
    const fnTotal = esChin ? valorMonetarioReservaChinchorro : valorMonetarioReservaHabitacion;
    const fnSaldo = esChin ? saldoReservaChinchorro : saldoReservaHabitacion;
    const total = fnTotal(r);
    const saldo = fnSaldo(r);
    const abonado = montoAbonadoReserva(r);
    if (saldo <= 0.005) {
        alert('Esta reserva ya está totalizada.');
        return;
    }
    const etiqueta = esChin ? etiquetaChinchorroReserva(r) : etiquetaHabitacionReserva(r);
    const huesped = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim();
    document.getElementById('abonoReservaTipo').value = tipo;
    document.getElementById('abonoReservaId').value = String(id);
    document.getElementById('tituloModalAbono').textContent = esChin ? 'Abonar reserva de chinchorro' : 'Abonar reserva de habitación';
    document.getElementById('resumenAbonoReserva').innerHTML =
        `<strong>${escapeHtmlCal(etiqueta)}</strong> · ${escapeHtmlCal(huesped || 'Huésped')}<br>` +
        `Total: <strong>${escapeHtmlCal(formatoMoneda(total))}</strong> · ` +
        `Abonado: <strong>${escapeHtmlCal(formatoMoneda(abonado))}</strong> · ` +
        `Saldo: <strong>${escapeHtmlCal(formatoMoneda(saldo))}</strong>`;
    const input = document.getElementById('montoAbonoReserva');
    input.value = '';
    input.removeAttribute('max');
    input.dataset.abonadoActual = String(abonado);
    input.dataset.saldoMax = String(saldo);
    actualizarPreviewAbonoReserva();
    document.getElementById('modalAbonoReserva').classList.add('active');
    requestAnimationFrame(() => input.focus());
}

function mostrarModalAbonoHabitacion(id) {
    abrirModalAbonoReserva('habitacion', id);
}

function mostrarModalAbonoChinchorro(id) {
    abrirModalAbonoReserva('chinchorro', id);
}

async function confirmarAbonoReserva(event) {
    event.preventDefault();
    const tipo = document.getElementById('abonoReservaTipo').value;
    const id = parseInt(document.getElementById('abonoReservaId').value, 10);
    const monto = parseFloat(document.getElementById('montoAbonoReserva').value);
    if (!Number.isFinite(id) || id < 1) {
        alert('Reserva no válida');
        return;
    }
    if (!Number.isFinite(monto) || monto <= 0) {
        alert('Indique un monto de abono mayor a cero');
        return;
    }
    const input = document.getElementById('montoAbonoReserva');
    const abonadoActual = parseFloat(input && input.dataset.abonadoActual) || 0;
    const saldoMax = parseFloat(input && input.dataset.saldoMax) || 0;
    if (monto > saldoMax + 0.005) {
        if (!confirm(`El abono (${formatoMoneda(monto)}) supera el saldo (${formatoMoneda(saldoMax)}). Se registrará solo ${formatoMoneda(saldoMax)}. ¿Continuar?`)) {
            return;
        }
    }
    const base = tipo === 'chinchorro' ? 'reservas-chinchorros' : 'reservas';
    try {
        const response = await fetchWithAuth(`${API_URL}/${base}/${id}/abono`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monto, monto_abonado: monto })
        });
        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            cerrarModal('modalAbonoReserva');
            if (tipo === 'chinchorro') {
                cargarReservasChinchorros();
            } else {
                cargarReservas();
                cargarHabitaciones();
            }
            renderIndicadoresFinanciero();
            const nuevoAbonado = data.monto_abonado != null ? formatoMoneda(data.monto_abonado) : '';
            const saldoRest = data.saldo != null ? formatoMoneda(data.saldo) : '';
            alert(
                nuevoAbonado
                    ? `Abono registrado. Nuevo abonado: ${nuevoAbonado}${saldoRest ? ` · Saldo: ${saldoRest}` : ''}`
                    : 'Abono registrado correctamente.'
            );
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo registrar el abono.');
            alert('Error: ' + msg);
        }
    } catch (error) {
        alert('Error al registrar el abono');
        console.error(error);
    }
}

async function totalizarReservaPago(tipo, id) {
    const esChin = tipo === 'chinchorro';
    const r = esChin
        ? reservasChinchorros.find((x) => Number(x.id) === Number(id))
        : reservas.find((x) => Number(x.id) === Number(id));
    if (!r) {
        alert('No se encontró la reserva.');
        return;
    }
    const fnSaldo = esChin ? saldoReservaChinchorro : saldoReservaHabitacion;
    const saldo = fnSaldo(r);
    if (saldo <= 0.005) {
        alert('Esta reserva ya está totalizada.');
        return;
    }
    if (!confirm(`¿Registrar el pago completo de ${formatoMoneda(saldo)} y totalizar la reserva?`)) {
        return;
    }
    const base = esChin ? 'reservas-chinchorros' : 'reservas';
    try {
        const response = await fetchWithAuth(`${API_URL}/${base}/${id}/totalizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
            if (esChin) {
                cargarReservasChinchorros();
            } else {
                cargarReservas();
                cargarHabitaciones();
            }
            renderIndicadoresFinanciero();
            alert('Reserva totalizada correctamente.');
        } else {
            const msg = await mensajeErrorRespuestaFetch(response, 'No se pudo totalizar la reserva.');
            alert('Error: ' + msg);
        }
    } catch (error) {
        alert('Error al totalizar la reserva');
        console.error(error);
    }
}

function totalizarReservaHabitacionPago(id) {
    totalizarReservaPago('habitacion', id);
}

function totalizarReservaChinchorroPago(id) {
    totalizarReservaPago('chinchorro', id);
}

// ========== FUNCIONES DE MODALES ==========
function cerrarModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    if (modalId === 'modalReserva') {
        document.getElementById('idReservaEdicion').value = '';
        const titulo = document.getElementById('tituloModalReserva');
        if (titulo) {
            titulo.textContent = 'Nueva Reserva';
        }
        establecerModoModalReserva(false);
    }
    if (modalId === 'modalHabitacion') {
        document.getElementById('idHabitacionEdicion').value = '';
        const t = document.getElementById('tituloModalHabitacion');
        if (t) t.textContent = 'Nueva habitación';
        const b = document.getElementById('btnSubmitHabitacion');
        if (b) b.textContent = 'Guardar';
        mostrarBloqueCamasNuevaHabitacion(true);
    }
    if (modalId === 'modalChinchorro') {
        document.getElementById('idChinchorroEdicion').value = '';
        const t = document.getElementById('tituloModalChinchorro');
        if (t) t.textContent = 'Nuevo chinchorro';
        const b = document.getElementById('btnSubmitChinchorro');
        if (b) b.textContent = 'Guardar';
    }
    if (modalId === 'modalReservaChinchorro') {
        document.getElementById('idReservaChinchorroEdicion').value = '';
        const tit = document.getElementById('tituloModalReservaChin');
        if (tit) tit.textContent = 'Reservar chinchorro';
        establecerModoModalReservaChin(false);
    }
    if (modalId === 'modalAbonoReserva') {
        document.getElementById('formAbonoReserva').reset();
        document.getElementById('abonoReservaTipo').value = '';
        document.getElementById('abonoReservaId').value = '';
    }
}

// Cerrar modales al hacer clic fuera
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            cerrarModal(modal.id);
        }
    });
}
