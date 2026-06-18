# Guía de Uso y Administración: Catálogo de Productos Premium (Sedelynk)

Esta guía detalla exhaustivamente el funcionamiento de la plataforma de catálogo digital, el portal de clientes y el panel de administración multi-tenant. Úsala para comprender, configurar y mantener el sistema de forma local o en producción.

---

## 1. Portal del Cliente (Catálogo Público)

El catálogo público es la interfaz responsive donde los visitantes consultan el inventario de la tienda y estructuran sus pedidos.

### 1.1. Búsqueda y Navegación
*   **Buscador en tiempo real (`#buscar-producto`):** Permite a los clientes buscar productos ingresando texto en el campo de búsqueda superior. La consulta filtra instantáneamente los nombres de los productos sin recargar la página.
*   **Filtros de Categorías (`#category-buttons`):** Botones horizontales deslizables que agrupan los productos por su sección correspondiente (ej: Verduras, Frutas, Bebidas). El botón "Todos" (`#cat-todos`) limpia los filtros activos.
*   **Diseño Adaptativo:** La rejilla de productos (`#grid-productos`) cambia automáticamente entre 2 columnas en teléfonos móviles, 3 en tablets y 4 en pantallas de escritorio para una navegación óptima.

### 1.2. Carrito de Compras e Interactividad
*   **Control de Cantidades:** Los clientes pueden añadir o remover productos usando los controles de cantidad `+` y `-` en cada tarjeta.
*   **Barra de Pedido Flotante (`#catalog-cart-entry`):** Se despliega en la parte inferior de la pantalla al seleccionar al menos un producto, mostrando:
    *   Cantidad de artículos seleccionados (`#mini-cart-count`).
    *   Monto total de la compra en quetzales (`#total-val`).
*   **Formulario de Confirmación:** Al hacer clic en "Confirmar Orden", se abre un panel emergente (`#modal-validacion`) que solicita:
    *   **Nombre del Cliente** (Obligatorio).
    *   **Teléfono de Contacto** (Obligatorio).
    *   **Dirección de Entrega** y **Comentarios** (Opcionales o requeridos según la configuración de ajustes).

### 1.3. Envío y Generación de Comprobantes
*   **Descarga de Recibo PDF:** Genera un archivo PDF limpio y estructurado con el desglose de productos, cantidades, precios unitarios, subtotal y total general. El diseño del PDF se adapta automáticamente al color de tema seleccionado por la tienda.
*   **Enviar por WhatsApp:** Redirige al cliente a la aplicación de WhatsApp con un mensaje pre-formateado que contiene el detalle completo de la orden, permitiendo al administrador recibir y procesar el pedido de forma organizada.

---

## 2. Acceso y Seguridad del Administrador

El panel de control permite a los dueños de negocios gestionar su catálogo de manera segura.

### 2.1. Rutas de Acceso
*   **Acceso Privado por URL:** Cada negocio tiene una ruta única estructurada como `/c/[tenant]/p/[adminAccessKey]`, donde `[tenant]` es el identificador del negocio y `[adminAccessKey]` es la llave de seguridad generada automáticamente al crear la cuenta.
*   **Acceso por Formulario:** También es posible iniciar sesión desde el portal principal ingresando el usuario, correo o número de cuenta de la tienda y la contraseña correspondiente.

### 2.2. Recuperación y Gestión de Credenciales
*   **Recuperación por Correo:** Si el administrador olvida sus datos, puede solicitar un enlace de restauración de contraseña que se envía a su correo registrado.
*   **Código de Recuperación Temporal:** En caso de emergencia, el Super Admin de la plataforma puede generar un código numérico temporal de un solo uso con expiración programada para desbloquear la cuenta.
*   **Bloqueo de Seguridad:** El sistema bloquea temporalmente los intentos de acceso tras ingresar credenciales erróneas consecutivamente para evitar ataques de fuerza bruta.

---

## 3. Módulos del Panel de Administración (Dashboard)

El panel administrativo se organiza en tres secciones operativas accesibles desde la barra de navegación lateral.

### 3.1. Módulo de Inventario (Gestión de Productos y Categorías)
Este módulo es el corazón del control de la tienda:

*   **Crear Categoría (`button[onclick*="abrirModalCategoria"]`):**
    *   Abre el modal `#modal-admin-categoria`.
    *   Requiere ingresar el **Nombre de la categoría** (`#admin-categoria-nombre-input`).
    *   Permite agrupar los artículos y estructurar el catálogo público.
*   **Agregar Producto (`button[onclick="abrirAdminForm()"]`):**
    *   Despliega el formulario modal `#modal-admin-form`.
    *   **Campos Requeridos:**
        *   **Nombre del Producto** (`#admin-nombre`): Nombre claro y comercial.
        *   **Categoría** (`#admin-categoria`): Menú desplegable para vincularlo a una categoría existente.
        *   **Unidad de Medida** (`#admin-unidad`): Especificación de venta (ej: lb, unidad, manojo).
        *   **Precio (Q)** (`#admin-precio`): Valor numérico decimal para el costo de venta.
        *   **Orden Visual** (`#admin-orden`): Número entero que determina la prioridad de visualización del producto en la tienda (se muestra en la columna "Stock").
    *   **Campos Opcionales:**
        *   **Descripción del producto** (`#admin-descripcion`): Detalles técnicos o comerciales.
        *   **Imágenes del producto** (`#admin-foto`): Permite cargar hasta 3 imágenes mediante explorador o arrastrar (`drag & drop`). La primera se define como imagen de portada.
        *   **Estado Activo** (`#admin-activo`): Controla la visibilidad inmediata en el catálogo público.
*   **Acciones Secundarias en la Lista:**
    *   **Editar (`button[onclick*="editarProducto"]`):** Abre el modal del producto con toda la información cargada para su modificación rápida.
    *   **Pausar Visibilidad (`button[onclick*="toggleProductStatus"]`):** Cambia el interruptor de estado (Activo/Inactivo) para ocultar o mostrar el producto del catálogo público en tiempo real sin eliminarlo.
    *   **Eliminar (`button[onclick*="abrirConfirmDelete"]`):** Abre la confirmación `#modal-confirm-delete` para remover permanentemente el artículo y borrar sus archivos de imagen asociados del servidor.

### 3.2. Historial de Pedidos
*   **Reportes en tiempo real:** Muestra la suma total de facturación acumulada y la cantidad de pedidos recibidos durante el día actual.
*   **Historial de Recibos:** Lista los pedidos ordenados cronológicamente, permitiendo volver a descargar el PDF original del recibo de cualquier cliente.
*   **Limpieza de Historial:** El administrador puede vaciar la lista de pedidos antiguos ingresando un PIN de confirmación.

### 3.3. Configuración y Ajustes
*   **WhatsApp de Pedidos:** Permite actualizar el número receptor de pedidos. Debe ingresarse en formato internacional sin espacios ni símbolos (ej: `502XXXXXXXX` para Guatemala).
*   **Temas de Apariencia:** Selector interactivo con **15 paletas de colores premium** (Verde, Violeta, Azul, etc.) que personalizan instantáneamente tanto el panel administrativo como el catálogo público del cliente.
*   **Seguridad:** Formulario para la actualización de la contraseña actual de administración.

---

## 4. Buenas Prácticas y Mantenimiento

1.  **Optimización de Imágenes:** Se recomienda utilizar imágenes con relación de aspecto cuadrada (1:1) y fondos limpios. El backend convertirá automáticamente las imágenes a formato WebP optimizado para acelerar la carga en redes móviles.
2.  **Formato de WhatsApp:** El número ingresado en los ajustes debe llevar obligatoriamente el código del país sin el símbolo `+` (ej: `502` para Guatemala) para que el enlace de mensajería funcione correctamente.
3.  **Seguridad de Acceso:** No compartas tu URL de acceso privado con terceros. Cambia la contraseña periódicamente y mantén configurado un correo electrónico válido para recuperación.
