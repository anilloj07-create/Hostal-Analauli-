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
        mostrarReservas('tablaReservas');
        mostrarReservasChinchorros();
        return;
    }
    if (k === 'chinchorros') {
        mostrarChinchorros();
    }
}

function habitacionesFiltradas() {
    const t = filtrosBusqueda.habitaciones;
    if (!t) return habitaciones;
    return habitaciones.filter((h) =>
        coincideBusqueda(h.numero, t) ||
        coincideBusqueda(h.tipo, t) ||
        coincideBusqueda(h.estado, t)
    );
}

function huespedesFiltrados() {
    const t = filtrosBusqueda.huespedes;
    if (!t) return huespedes;
    return huespedes.filter((h) =>
        coincideBusqueda(h.nombre, t) ||
        coincideBusqueda(h.apellido, t) ||
        coincideBusqueda(h.documento, t)
    );
}

function reservasHabitacionesFiltradas() {
    const t = filtrosBusqueda.reservas;
    if (!t) return reservas;
    return reservas.filter((r) =>
        coincideBusqueda(r.id, t) ||
        coincideBusqueda(r.habitacion_numero, t) ||
        coincideBusqueda(r.huesped_nombre, t) ||
        coincideBusqueda(r.huesped_apellido, t) ||
        coincideBusqueda(r.estado, t)
    );
}

function reservasChinchorrosFiltradas() {
    const t = filtrosBusqueda.reservas;
    if (!t) return reservasChinchorros;
    return reservasChinchorros.filter((r) =>
        coincideBusqueda(r.id, t) ||
        coincideBusqueda(r.chinchorro_codigo, t) ||
        coincideBusqueda(r.huesped_nombre, t) ||
        coincideBusqueda(r.huesped_apellido, t) ||
        coincideBusqueda(r.estado, t)
    );
}

function chinchorrosFiltrados() {
    const t = filtrosBusqueda.chinchorros;
    if (!t) return chinchorros;
    return chinchorros.filter((c) =>
        coincideBusqueda(c.codigo, t) ||
        coincideBusqueda(c.zona, t) ||
        coincideBusqueda(c.estado, t)
    );
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

function sumarValoresReservas(lista, fnValor) {
    return lista.reduce((acc, r) => acc + fnValor(r), 0);
}

function calcularResumenFinancieroReservas() {
    const habNoCancel = reservas.filter((r) => r.estado !== 'Cancelada');
    const chinNoCancel = reservasChinchorros.filter((r) => r.estado !== 'Cancelada');
    const habActivas = reservas.filter((r) => r.estado === 'Activa');
    const chinActivas = reservasChinchorros.filter((r) => r.estado === 'Activa');
    const habFinal = reservas.filter((r) => r.estado === 'Finalizada');
    const chinFinal = reservasChinchorros.filter((r) => r.estado === 'Finalizada');

    const ingresosHab = sumarValoresReservas(habNoCancel, valorMonetarioReservaHabitacion);
    const ingresosChin = sumarValoresReservas(chinNoCancel, valorMonetarioReservaChinchorro);
    const pagadoHab = sumarValoresReservas(habFinal, valorMonetarioReservaHabitacion);
    const pagadoChin = sumarValoresReservas(chinFinal, valorMonetarioReservaChinchorro);
    const adeudadoHab = sumarValoresReservas(habActivas, valorMonetarioReservaHabitacion);
    const adeudadoChin = sumarValoresReservas(chinActivas, valorMonetarioReservaChinchorro);

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

function renderIndicadoresFinanciero() {
    const panel = document.getElementById('indicadoresFinancieros');
    if (!panel) return;

    const f = calcularResumenFinancieroReservas();
    const detHabIng = `Habitaciones: ${formatoMoneda(f.ingresosHab)} · ${f.countHab} reserva(s)`;
    const detChinIng = `Chinchorros: ${formatoMoneda(f.ingresosChin)} · ${f.countChin} reserva(s)`;

    panel.innerHTML = `
        <div class="fin-estado-grid">
            ${htmlFinCard('fin-ingresos', 'Ingresos Totales', f.ingresosTotales, `${detHabIng}<br>${detChinIng}`)}
            ${htmlFinCard('fin-pagado', 'Pagado', f.pagado, `Finalizadas · Hab. ${formatoMoneda(f.pagadoHab)} · Chin. ${formatoMoneda(f.pagadoChin)}`)}
            ${htmlFinCard('fin-adeudado', 'Adeudado', f.adeudado, `Activas (pendiente) · Hab. ${formatoMoneda(f.adeudadoHab)} · Chin. ${formatoMoneda(f.adeudadoChin)}`)}
        </div>
        <p class="fin-estado-nota">
            Los montos se calculan con la tarifa registrada en cada reserva (noches × tarifa/noche o días × tarifa/día).
            <strong>Pagado</strong> = reservas finalizadas; <strong>Adeudado</strong> = reservas activas aún en curso.
            Las canceladas no se incluyen en ingresos totales.
        </p>
    `;
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
    
    // Si está autenticado, cargar datos
    cargarNombreHotel();
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
});

// ========== FUNCIONES DE NAVEGACIÓN ==========
function mostrarSeccion(seccion, boton) {
    document.querySelectorAll('.seccion').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`seccion-${seccion}`).classList.add('active');
    if (boton) {
        boton.classList.add('active');
    }
    if (seccion === 'indicadores') {
        refrescarPanelesOcupacionDual();
        renderIndicadoresOcupacion();
        renderIndicadoresFinanciero();
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

function diaOcupadoPorReservaActiva(recursoId, ymd, listaReservas, idCampo) {
    return listaReservas.some((r) => {
        if (r.estado !== 'Activa') return false;
        if (Number(r[idCampo]) !== Number(recursoId)) return false;
        const ing = String(r.fecha_ingreso).slice(0, 10);
        const sal = String(r.fecha_salida).slice(0, 10);
        return ymd >= ing && ymd <= sal;
    });
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
        headNums += `<th class="cal-dia-num" scope="col" title="${ymd}">${dayNum}</th>`;
        headDow += `<th class="cal-dia-dow" scope="col">${DIAS_SEMANA_CAL[date.getDay()]}</th>`;
    });
    headNums += '</tr>';
    headDow += '</tr>';

    let body = '';
    filas.forEach((f) => {
        body += `<tr><th class="cal-recurso" scope="row">${escapeHtmlCal(f.label)}</th>`;
        dias.forEach(({ ymd }) => {
            const ocupado = diaOcupadoPorReservaActiva(f.id, ymd, listaReservas, idCampo);
            const cls = ocupado ? 'cal-ocupado' : 'cal-libre';
            const estadoTxt = ocupado ? 'Ocupado' : 'Disponible';
            const tituloCelda = attrEsc(`${f.label} · ${ymd} · ${estadoTxt}`);
            body += `<td class="cal-cell ${cls}" title="${tituloCelda}"><span class="cal-cell-inner">${ocupado ? '●' : '·'}</span></td>`;
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
    const filasHab = habitaciones.map((h) => ({ id: h.id, label: h.numero }));
    const filasCh = chinchorros.map((c) => ({ id: c.id, label: c.codigo }));

    wrapH.innerHTML = construirTablaCalendario('Habitación', filasHab, dias, 'habitacion_id', reservas);
    wrapC.innerHTML = construirTablaCalendario('Chinchorro', filasCh, dias, 'chinchorro_id', reservasChinchorros);
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

function claseEstadoBadgeRecurso(estado) {
    const e = String(estado == null ? '' : estado)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9áéíóúñ_-]+/gi, '-')
        .replace(/^-+|-+$/g, '');
    return `estado-badge estado-${e || 'desconocido'}`;
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
        fondo_imagen_url: document.getElementById('temaFondoImagenUrl').value.trim()
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
    if (!confirm('¿Restaurar apariencia predeterminada (colores y fondo)?')) {
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
    const ocupadas = habitaciones.filter((h) => h.estado === 'Ocupada').length;
    const disponibles = habitaciones.filter((h) => h.estado === 'Disponible').length;
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
        const o = habitaciones.filter((h) => h.estado === 'Ocupada').length;
        const d = habitaciones.filter((h) => h.estado === 'Disponible').length;
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

async function actualizarIndicadoresOcupacion() {
    await Promise.all([
        cargarHabitaciones(),
        cargarChinchorros(),
        cargarReservas(),
        cargarReservasChinchorros()
    ]);
    renderIndicadoresOcupacion();
    renderIndicadoresFinanciero();
    refrescarPanelesOcupacionDual();
}

function mostrarHabitaciones() {
    const grid = document.getElementById('gridHabitaciones');
    const tbody = document.getElementById('tablaHabitacionesInv');

    actualizarResumenOcupacion();
    refrescarPanelesOcupacionDual();
    renderIndicadoresOcupacion();
    renderIndicadoresFinanciero();

    aplicarLayoutsVistasInventarioDesdeHotel();

    const v = vistaInventarioNormalizada(datosHotelCache && datosHotelCache.vista_habitaciones);
    const vacioGrid =
        '<p style="text-align: center; color: #666; padding: 40px;">No hay habitaciones registradas. Crea una nueva habitación para comenzar.</p>';
    const vacioTabla =
        '<tr><td colspan="6" style="text-align: center; padding: 24px; color: #666;">No hay habitaciones registradas.</td></tr>';

    if (habitaciones.length === 0) {
        if (grid) grid.innerHTML = vacioGrid;
        if (tbody) tbody.innerHTML = vacioTabla;
        return;
    }

    const listaHabitaciones = habitacionesFiltradas();
    if (listaHabitaciones.length === 0) {
        if (grid) grid.innerHTML = '<p style="text-align: center; color: #666; padding: 30px;">Sin resultados para la búsqueda actual.</p>';
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }

    if (v === 'tabla') {
        if (grid) grid.innerHTML = '';
        if (tbody) {
            tbody.innerHTML = listaHabitaciones
                .map((habitacion) => {
                    const precio = formatoMoneda(Number(habitacion.precio_diario) || 0);
                    const est = habitacion.estado || '';
                    const numJson = JSON.stringify(habitacion.numero != null ? String(habitacion.numero) : '');
                    const estJson = JSON.stringify(est);
                    const accionEstado =
                        est === 'Disponible'
                            ? '🔒 Ocupar'
                            : '🔓 Liberar';
                    return `
            <tr>
                <td><strong>${escapeHtmlCal(habitacion.numero)}</strong></td>
                <td>${escapeHtmlCal(habitacion.tipo || 'N/A')}</td>
                <td>${escapeHtmlCal(precio)}</td>
                <td>${escapeHtmlCal(String(habitacion.total_camas ?? 0))}</td>
                <td><span class="${claseEstadoBadgeRecurso(est)}">${escapeHtmlCal(est)}</span></td>
                <td class="td-acciones-inventario">
                    <button type="button" class="btn-primary btn-small" onclick="gestionarCamas(${habitacion.id}, ${numJson})">🛏️ Camas</button>
                    <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarHabitacion(${habitacion.id})">✏️ Tarifa / datos</button>
                    <button type="button" class="btn-secondary btn-small" onclick="cambiarEstadoHabitacion(${habitacion.id}, ${estJson})">${accionEstado}</button>
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
                <div class="habitacion-numero">Habitación ${escapeHtmlCal(habitacion.numero)}</div>
                <span class="${claseEstadoBadgeRecurso(est)}">
                    ${escapeHtmlCal(est)}
                </span>
            </div>
            <div class="habitacion-info">
                <p><strong>Tipo:</strong> ${escapeHtmlCal(habitacion.tipo || 'N/A')}</p>
                <p><strong>Tarifa / noche:</strong> ${escapeHtmlCal(precio)}</p>
                <p><strong>Camas:</strong> ${escapeHtmlCal(String(habitacion.total_camas || 0))}</p>
            </div>
            <div class="habitacion-acciones">
                <button class="btn-primary btn-small" onclick="gestionarCamas(${habitacion.id}, ${JSON.stringify(
                    habitacion.numero != null ? String(habitacion.numero) : ''
                )})">
                    🛏️ Camas
                </button>
                <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarHabitacion(${habitacion.id})">✏️ Tarifa / datos</button>
                <button class="btn-secondary btn-small" onclick="cambiarEstadoHabitacion(${habitacion.id}, ${JSON.stringify(est)})">
                    ${est === 'Disponible' ? '🔒 Ocupar' : '🔓 Liberar'}
                </button>
                <button class="btn-danger btn-small" onclick="eliminarHabitacion(${habitacion.id})">
                    🗑️ Eliminar
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function mostrarModalHabitacion() {
    document.getElementById('formHabitacion').reset();
    document.getElementById('idHabitacionEdicion').value = '';
    document.getElementById('tituloModalHabitacion').textContent = 'Nueva habitación';
    const btn = document.getElementById('btnSubmitHabitacion');
    if (btn) btn.textContent = 'Guardar';
    document.getElementById('precioHabitacion').value = '0';
    document.getElementById('modalHabitacion').classList.add('active');
}

function mostrarModalEditarHabitacion(id) {
    const hab = habitaciones.find((x) => Number(x.id) === Number(id));
    if (!hab) return;
    document.getElementById('idHabitacionEdicion').value = String(hab.id);
    document.getElementById('numeroHabitacion').value = hab.numero || '';
    document.getElementById('tipoHabitacion').value = hab.tipo || '';
    document.getElementById('precioHabitacion').value =
        hab.precio_diario != null && Number(hab.precio_diario) > 0 ? String(hab.precio_diario) : '0';
    document.getElementById('tituloModalHabitacion').textContent = 'Editar habitación';
    const btn = document.getElementById('btnSubmitHabitacion');
    if (btn) btn.textContent = 'Guardar cambios';
    document.getElementById('modalHabitacion').classList.add('active');
}

async function guardarHabitacion(event) {
    event.preventDefault();
    const idEd = document.getElementById('idHabitacionEdicion').value.trim();
    const numero = document.getElementById('numeroHabitacion').value.trim();
    const tipo = document.getElementById('tipoHabitacion').value.trim();
    const precioRaw = document.getElementById('precioHabitacion').value;
    const precio_diario =
        precioRaw === '' || precioRaw == null ? 0 : Math.max(0, parseFloat(precioRaw) || 0);

    try {
        let response;
        if (idEd) {
            response = await fetchWithAuth(`${API_URL}/habitaciones/${parseInt(idEd, 10)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numero, tipo, precio_diario })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/habitaciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numero, tipo, precio_diario })
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

async function cambiarEstadoHabitacion(id, estadoActual) {
    const nuevoEstado = estadoActual === 'Disponible' ? 'Ocupada' : 'Disponible';
    
    try {
        const response = await fetchWithAuth(`${API_URL}/habitaciones/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        
        if (response.ok) {
            cargarHabitaciones();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al cambiar el estado');
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
                    const precio = formatoMoneda(Number(c.precio_diario) || 0);
                    const est = c.estado || '';
                    const estJson = JSON.stringify(est);
                    const accionEstado =
                        est === 'Disponible'
                            ? '🔒 Marcar ocupado'
                            : '🔓 Marcar libre';
                    return `
            <tr>
                <td><strong>${escapeHtmlCal(c.codigo)}</strong></td>
                <td>${escapeHtmlCal(c.zona || 'N/A')}</td>
                <td>${escapeHtmlCal(precio)}</td>
                <td>${escapeHtmlCal(String(c.reservas_activas ?? 0))}</td>
                <td><span class="${claseEstadoBadgeRecurso(est)}">${escapeHtmlCal(est)}</span></td>
                <td class="td-acciones-inventario">
                    <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarChinchorro(${c.id})">✏️ Tarifa / datos</button>
                    <button type="button" class="btn-secondary btn-small" onclick="cambiarEstadoChinchorro(${c.id}, ${estJson})">${accionEstado}</button>
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
        const precio = formatoMoneda(Number(c.precio_diario) || 0);
        const est = c.estado || '';
        card.innerHTML = `
            <div class="habitacion-header">
                <div class="habitacion-numero">${escapeHtmlCal(c.codigo)}</div>
                <span class="${claseEstadoBadgeRecurso(est)}">${escapeHtmlCal(est)}</span>
            </div>
            <div class="habitacion-info">
                <p><strong>Zona:</strong> ${escapeHtmlCal(c.zona || 'N/A')}</p>
                <p><strong>Tarifa / día:</strong> ${escapeHtmlCal(precio)}</p>
                <p><strong>Reservas activas (hoy):</strong> ${escapeHtmlCal(String(c.reservas_activas ?? 0))}</p>
            </div>
            <div class="habitacion-acciones">
                <button type="button" class="btn-secondary btn-small" onclick="mostrarModalEditarChinchorro(${c.id})">✏️ Tarifa / datos</button>
                <button type="button" class="btn-secondary btn-small" onclick="cambiarEstadoChinchorro(${c.id}, ${JSON.stringify(est)})">
                    ${est === 'Disponible' ? '🔒 Marcar ocupado' : '🔓 Marcar libre'}
                </button>
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
    document.getElementById('codigoChinchorro').removeAttribute('readonly');
    const btn = document.getElementById('btnSubmitChinchorro');
    if (btn) btn.textContent = 'Guardar';
    document.getElementById('precioChinchorro').value = '0';
    document.getElementById('modalChinchorro').classList.add('active');
}

function mostrarModalEditarChinchorro(id) {
    const c = chinchorros.find((x) => Number(x.id) === Number(id));
    if (!c) return;
    document.getElementById('idChinchorroEdicion').value = String(c.id);
    document.getElementById('codigoChinchorro').value = c.codigo || '';
    document.getElementById('zonaChinchorro').value = c.zona || '';
    document.getElementById('precioChinchorro').value =
        c.precio_diario != null && Number(c.precio_diario) > 0 ? String(c.precio_diario) : '0';
    document.getElementById('tituloModalChinchorro').textContent = 'Editar chinchorro';
    document.getElementById('codigoChinchorro').setAttribute('readonly', 'readonly');
    const btn = document.getElementById('btnSubmitChinchorro');
    if (btn) btn.textContent = 'Guardar cambios';
    document.getElementById('modalChinchorro').classList.add('active');
}

async function guardarChinchorro(event) {
    event.preventDefault();
    const idEd = document.getElementById('idChinchorroEdicion').value.trim();
    const codigo = document.getElementById('codigoChinchorro').value.trim();
    const zona = document.getElementById('zonaChinchorro').value.trim();
    const precioRaw = document.getElementById('precioChinchorro').value;
    const precio_diario =
        precioRaw === '' || precioRaw == null ? 0 : Math.max(0, parseFloat(precioRaw) || 0);
    try {
        let response;
        if (idEd) {
            response = await fetchWithAuth(`${API_URL}/chinchorros/${parseInt(idEd, 10)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigo, zona, precio_diario })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/chinchorros`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigo, zona, precio_diario })
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

async function cambiarEstadoChinchorro(id, estadoActual) {
    const nuevoEstado = estadoActual === 'Disponible' ? 'Ocupada' : 'Disponible';
    try {
        const response = await fetchWithAuth(`${API_URL}/chinchorros/${id}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        if (response.ok) {
            cargarChinchorros();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        alert('Error al cambiar el estado');
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
        mostrarReservasChinchorros();
        refrescarPanelesOcupacionDual();
        actualizarAlertasSalidasHoy();
        renderIndicadoresFinanciero();
    } catch (error) {
        console.error('Error al cargar reservas de chinchorros:', error);
    }
}

function mostrarReservasChinchorros() {
    const tbody = document.getElementById('tablaReservasChinchorros');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (reservasChinchorros.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: #666;">No hay reservas de chinchorros.</td></tr>';
        return;
    }
    const lista = reservasChinchorrosFiltradas();
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }
    lista.forEach((r) => {
        const row = document.createElement('tr');
        const fi = new Date(r.fecha_ingreso).toLocaleDateString('es-ES');
        const fs = new Date(r.fecha_salida).toLocaleDateString('es-ES');
        const estadoClass = r.estado === 'Activa' ? 'estado-disponible' : 'estado-ocupada';
        row.innerHTML = `
            <td>${r.id}</td>
            <td><strong>${r.chinchorro_codigo}</strong></td>
            <td>${r.huesped_nombre} ${r.huesped_apellido || ''}</td>
            <td>${fi}</td>
            <td>${fs}</td>
            <td><span class="estado-badge ${estadoClass}">${r.estado}</span></td>
            <td>${textoValorReservaChinchorro(r)}</td>
            <td>
                ${r.estado === 'Activa' ? `<button type="button" class="btn-secondary btn-small" onclick="modificarReservaChinchorro(${r.id})">✏️ Modificar</button>` : ''}
                ${r.estado === 'Activa' ? `<button type="button" class="btn-secondary btn-small" onclick="cancelarReservaChinchorro(${r.id})">❌ Cancelar</button>` : ''}
                <button type="button" class="btn-danger btn-small" onclick="eliminarReservaChinchorro(${r.id})">🗑️ Eliminar</button>
            </td>
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
            const o = document.createElement('option');
            o.value = c.id;
            const tarifa = formatoMoneda(Number(c.precio_diario) || 0);
            o.textContent = `${c.codigo} · ${tarifa}/día · ${c.estado}`;
            selC.appendChild(o);
        });
    }
    if (selH) {
        selH.innerHTML = '<option value="">Seleccionar huésped</option>';
        huespedes.forEach((h) => {
            const o = document.createElement('option');
            o.value = h.id;
            o.textContent = `${h.nombre} ${h.apellido || ''}`.trim();
            selH.appendChild(o);
        });
    }
}

function mostrarModalElegirTipoReserva() {
    const modal = document.getElementById('modalElegirTipoReserva');
    if (modal) modal.classList.add('active');
}

function elegirTipoReserva(tipo) {
    cerrarModal('modalElegirTipoReserva');
    if (tipo === 'habitacion') {
        mostrarModalReserva();
    } else if (tipo === 'chinchorro') {
        mostrarModalReservaChinchorro();
    }
}

function mostrarModalReservaChinchorro() {
    document.getElementById('formReservaChinchorro').reset();
    document.getElementById('idReservaChinchorroEdicion').value = '';
    const titulo = document.getElementById('tituloModalReservaChin');
    if (titulo) titulo.textContent = 'Reservar chinchorro';
    actualizarSelectsReservaChinchorro();
    const hoy = fechaLocalYMD();
    const fi = document.getElementById('fechaIngresoChin');
    const fs = document.getElementById('fechaSalidaChin');
    if (fi) fi.min = hoy;
    if (fs) {
        fs.min = fi && fi.value ? fi.value : hoy;
    }
    document.getElementById('modalReservaChinchorro').classList.add('active');
}

function modificarReservaChinchorro(id) {
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
    actualizarSelectsReservaChinchorro();
    requestAnimationFrame(() => {
        document.getElementById('chinchorroReserva').value = String(r.chinchorro_id);
        document.getElementById('huespedReservaChin').value = String(r.huesped_id);
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
    const fecha_ingreso = document.getElementById('fechaIngresoChin').value;
    const fecha_salida = document.getElementById('fechaSalidaChin').value;
    if (!Number.isFinite(chinchorro_id) || !Number.isFinite(huesped_id)) {
        alert('Seleccione chinchorro y huésped');
        return;
    }
    if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
        alert('La fecha de fin debe ser posterior al inicio');
        return;
    }
    try {
        let response;
        if (idEd) {
            response = await fetchWithAuth(`${API_URL}/reservas-chinchorros/${parseInt(idEd, 10)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chinchorro_id, huesped_id, fecha_ingreso, fecha_salida })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/reservas-chinchorros`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chinchorro_id, huesped_id, fecha_ingreso, fecha_salida })
            });
        }
        if (response.ok) {
            cerrarModal('modalReservaChinchorro');
            cargarReservasChinchorros();
            cargarChinchorros();
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
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #666;">No hay huéspedes registrados.</td></tr>';
        return;
    }

    const lista = huespedesFiltrados();
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
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
                body: JSON.stringify({ nombre, apellido, email, telefono, documento })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/huespedes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, apellido, email, telefono, documento })
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
        mostrarReservas('tablaReservas');
        actualizarSelectsReserva();
        refrescarPanelesOcupacionDual();
        actualizarAlertasSalidasHoy();
        renderIndicadoresFinanciero();
    } catch (error) {
        console.error('Error al cargar reservas:', error);
    }
}

function mostrarReservas(tbodyId = 'tablaReservas') {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (reservas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #666;">No hay reservas registradas.</td></tr>';
        return;
    }

    const lista = reservasHabitacionesFiltradas();
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #666;">Sin resultados para la búsqueda actual.</td></tr>';
        return;
    }

    lista.forEach(reserva => {
        const row = document.createElement('tr');
        const fechaIngreso = new Date(reserva.fecha_ingreso).toLocaleDateString('es-ES');
        const fechaSalida = new Date(reserva.fecha_salida).toLocaleDateString('es-ES');
        const estadoClass = reserva.estado === 'Activa' ? 'estado-disponible' : 'estado-ocupada';
        
        row.innerHTML = `
            <td>${reserva.id}</td>
            <td><strong>${reserva.habitacion_numero}</strong></td>
            <td>${reserva.huesped_nombre} ${reserva.huesped_apellido || ''}</td>
            <td>${fechaIngreso}</td>
            <td>${fechaSalida}</td>
            <td><span class="estado-badge ${estadoClass}">${reserva.estado}</span></td>
            <td>${textoValorReservaHabitacion(reserva)}</td>
            <td>
                <button type="button" class="btn-secondary btn-small" onclick="modificarReserva(${reserva.id})">✏️ Modificar</button>
                ${reserva.estado === 'Activa' ?
                    `<button type="button" class="btn-secondary btn-small" onclick="cancelarReserva(${reserva.id})">❌ Cancelar</button>` :
                    ''
                }
                <button type="button" class="btn-danger btn-small" onclick="eliminarReserva(${reserva.id})">🗑️ Eliminar</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function actualizarSelectsReserva() {
    // Actualizar select de habitaciones
    const selectHabitacion = document.getElementById('habitacionReserva');
    selectHabitacion.innerHTML = '<option value="">Seleccionar habitación</option>';
    habitaciones.forEach(hab => {
        const option = document.createElement('option');
        option.value = hab.id;
        const tarifa = formatoMoneda(Number(hab.precio_diario) || 0);
        option.textContent = `Hab. ${hab.numero} · ${tarifa}/noche · ${hab.estado}`;
        selectHabitacion.appendChild(option);
    });
    
    // Actualizar select de huéspedes
    const selectHuesped = document.getElementById('huespedReserva');
    selectHuesped.innerHTML = '<option value="">Seleccionar huésped</option>';
    huespedes.forEach(huesped => {
        const option = document.createElement('option');
        option.value = huesped.id;
        option.textContent = `${huesped.nombre} ${huesped.apellido || ''}`.trim();
        selectHuesped.appendChild(option);
    });
}

/** Asegura que exista la opción antes de asignar value (evita selects vacíos tras repoblar). */
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
    if (hint) {
        hint.hidden = !esEdicion;
    }
    if (btn) {
        btn.textContent = esEdicion ? '💾 Guardar cambios' : 'Reservar';
    }
}

function mostrarModalReserva() {
    document.getElementById('formReserva').reset();
    document.getElementById('idReservaEdicion').value = '';
    document.getElementById('tituloModalReserva').textContent = 'Nueva Reserva';
    establecerModoModalReserva(false);
    actualizarSelectsReserva();
    aplicarFechasMinNuevaReservaHabitacion();
    document.getElementById('modalReserva').classList.add('active');
}

function modificarReserva(id) {
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
        const selHue = document.getElementById('huespedReserva');
        const labelHab =
            r.habitacion_numero != null ? `Habitación ${r.habitacion_numero}` : null;
        const labelHue = `${r.huesped_nombre || ''} ${r.huesped_apellido || ''}`.trim();
        asegurarOpcionEnSelect(selHab, r.habitacion_id, labelHab);
        asegurarOpcionEnSelect(selHue, r.huesped_id, labelHue || undefined);
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
    const fecha_ingreso = document.getElementById('fechaIngreso').value;
    const fecha_salida = document.getElementById('fechaSalida').value;

    if (!Number.isFinite(habitacion_id) || !Number.isFinite(huesped_id)) {
        alert('Seleccione habitación y huésped');
        return;
    }

    if (new Date(fecha_ingreso) >= new Date(fecha_salida)) {
        alert('La fecha de salida debe ser posterior a la fecha de ingreso');
        return;
    }

    try {
        let response;
        if (idEdicion) {
            const idNum = parseInt(idEdicion, 10);
            response = await fetchWithAuth(`${API_URL}/reservas/${idNum}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ habitacion_id, huesped_id, fecha_ingreso, fecha_salida })
            });
        } else {
            response = await fetchWithAuth(`${API_URL}/reservas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ habitacion_id, huesped_id, fecha_ingreso, fecha_salida })
            });
        }

        if (response.ok) {
            cerrarModal('modalReserva');
            cargarReservas();
            cargarHabitaciones();
            if (idEdicion) {
                alert('Cambios guardados correctamente.');
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
    }
    if (modalId === 'modalChinchorro') {
        document.getElementById('idChinchorroEdicion').value = '';
        const t = document.getElementById('tituloModalChinchorro');
        if (t) t.textContent = 'Nuevo chinchorro';
        const b = document.getElementById('btnSubmitChinchorro');
        if (b) b.textContent = 'Guardar';
        const cod = document.getElementById('codigoChinchorro');
        if (cod) cod.removeAttribute('readonly');
    }
    if (modalId === 'modalReservaChinchorro') {
        document.getElementById('idReservaChinchorroEdicion').value = '';
        const tit = document.getElementById('tituloModalReservaChin');
        if (tit) tit.textContent = 'Reservar chinchorro';
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
