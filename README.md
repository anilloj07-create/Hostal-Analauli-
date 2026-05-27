# Sistema de Reservas de Hotel

Sistema completo de gestión de reservas de habitaciones de hotel con base de datos SQLite.

## Características

- ✅ **Sistema de Autenticación**: Control de acceso con usuario y contraseña
- ✅ **Gestión del Hotel**: Cambiar el nombre del hotel
- ✅ **Gestión de Habitaciones**: Crear habitaciones con número y tipo
- ✅ **Gestión de Camas**: Agregar camas a cada habitación (Individual, Doble, Queen, King)
- ✅ **Gestión de Huéspedes**: Crear y gestionar huéspedes con información completa
- ✅ **Sistema de Reservas**: Asignar huéspedes a habitaciones con fechas de ingreso y salida
- ✅ **Estados de Habitaciones**: Disponible / Ocupada (se actualiza automáticamente según reservas)
- ✅ **Base de Datos SQLite**: Almacenamiento persistente de todos los datos
- ✅ **Interfaz Moderna**: Diseño con tonos cálidos y experiencia de usuario optimizada

## Instalación

1. Instalar las dependencias:
```bash
npm install
```

2. Iniciar el servidor:
```bash
npm start
```

3. Abrir en el navegador:
```
http://localhost:3000
```

4. Iniciar sesión con las credenciales por defecto:
   - **Usuario**: `admin`
   - **Contraseña**: `admin123`

## Estructura del Proyecto

```
proyecto/
├── server.js          # Servidor Express con API REST
├── database.js        # Configuración y funciones de base de datos
├── package.json       # Dependencias del proyecto
├── hotel.db          # Base de datos SQLite (se crea automáticamente)
└── public/           # Frontend
    ├── index.html    # Interfaz principal
    ├── styles.css    # Estilos
    └── app.js        # Lógica del frontend
```

## Autenticación

El sistema requiere autenticación para acceder a todas las funcionalidades. Al acceder a la aplicación, se redirige automáticamente a la página de login si no hay una sesión activa.

### Credenciales por Defecto
- **Usuario**: `admin`
- **Contraseña**: `admin123`

### Seguridad
- Las contraseñas se almacenan con hash bcrypt
- Las sesiones se gestionan con express-session
- Todas las rutas API están protegidas con middleware de autenticación
- Las sesiones expiran después de 24 horas de inactividad

## API Endpoints

### Autenticación
- `POST /api/login` - Iniciar sesión (público)
- `POST /api/logout` - Cerrar sesión (requiere autenticación)
- `GET /api/auth/check` - Verificar estado de autenticación (público)

### Hotel
- `GET /api/hotel` - Obtener información del hotel
- `PUT /api/hotel` - Actualizar nombre del hotel

### Habitaciones
- `GET /api/habitaciones` - Listar todas las habitaciones
- `POST /api/habitaciones` - Crear nueva habitación
- `PUT /api/habitaciones/:id/estado` - Cambiar estado de habitación
- `DELETE /api/habitaciones/:id` - Eliminar habitación

### Camas
- `GET /api/habitaciones/:id/camas` - Listar camas de una habitación
- `POST /api/habitaciones/:id/camas` - Agregar cama a habitación
- `DELETE /api/camas/:id` - Eliminar cama

### Huéspedes
- `GET /api/huespedes` - Listar todos los huéspedes
- `POST /api/huespedes` - Crear nuevo huésped
- `DELETE /api/huespedes/:id` - Eliminar huésped

### Reservas
- `GET /api/reservas` - Listar todas las reservas
- `POST /api/reservas` - Crear nueva reserva
- `PUT /api/reservas/:id` - Actualizar habitación, huésped o fechas de una reserva
- `PUT /api/reservas/:id/estado` - Cambiar estado de reserva
- `DELETE /api/reservas/:id` - Eliminar reserva

## Uso

1. **Iniciar Sesión**: Al acceder a la aplicación, se mostrará la página de login. Ingresa las credenciales para acceder al sistema.

2. **Configurar el Hotel**: Ve a **Configuración** y usa **Editar nombre del hotel** para cambiar el nombre que aparece en la cabecera.

2. **Crear Habitaciones**: 
   - Ve a la pestaña "Habitaciones"
   - Haz clic en "+ Nueva Habitación"
   - Ingresa el número y tipo de habitación

3. **Agregar Camas**:
   - En cada habitación, haz clic en "🛏️ Camas"
   - Selecciona el tipo de cama y opcionalmente un número
   - Haz clic en "Agregar Cama"

4. **Crear Huéspedes**:
   - Ve a la pestaña "Huéspedes"
   - Haz clic en "+ Nuevo Huésped"
   - Completa la información del huésped

5. **Hacer una Reserva**:
   - Ve a la pestaña "Reservas"
   - Haz clic en "+ Nueva Reserva"
   - Selecciona habitación, huésped y fechas
   - El sistema verificará automáticamente disponibilidad

## Tecnologías Utilizadas

- **Backend**: Node.js, Express.js
- **Base de Datos**: SQLite3
- **Autenticación**: express-session, bcrypt
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Estilo**: Diseño moderno con tonos cálidos, gradientes y animaciones

## Notas

- La base de datos se crea automáticamente al iniciar el servidor
- Se crea un usuario administrador por defecto (admin/admin123) si no existe ningún usuario
- Los estados de las habitaciones se actualizan automáticamente según las reservas activas
- El sistema valida que no haya conflictos de fechas al crear reservas
- Todas las operaciones son persistentes en la base de datos
- Si la sesión expira o se pierde, se redirige automáticamente a la página de login