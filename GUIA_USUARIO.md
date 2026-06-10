# Guía de Uso y Administración: Catálogo de Productos Premium

Esta guía detalla el funcionamiento del catálogo digital y proporciona las instrucciones paso a paso para administrar los productos, pedidos, apariencia y configuraciones de seguridad.

---

## 1. Vista del Cliente (Catálogo Público)

El catálogo es una aplicación web responsive adaptada para teléfonos móviles, tablets y computadoras de escritorio.

*   **Buscador en tiempo real:** Los clientes pueden buscar productos por nombre escribiendo en la barra superior.
*   **Filtros por Categoría:** Filtros rápidos en la cabecera (Verduras, Frutas, Otros).
*   **Carrito de Compras:**
    1.  El usuario agrega productos usando los botones **`+`** e **`-`**.
    2.  Al seleccionar al menos un producto, se despliega una barra flotante inferior indicando el **Monto de tu Orden**.
    3.  Al hacer clic en **Confirmar Orden**, se abre un formulario para ingresar el Nombre y Teléfono del cliente.
    4.  El cliente tiene la opción de:
        *   **Descargar Recibo PDF:** Genera un comprobante digital limpio con el color del tema activo.
        *   **Enviar por WhatsApp:** Envía el pedido formateado con el detalle, cantidades, subtotales y total directamente al número del negocio.

---

## 2. Acceso al Panel de Administración

El panel de administración permite gestionar todo el sistema de forma protegida.

*   **Cómo ingresar:**
    1.  Abre la URL privada del panel entregada al crear la cuenta.
    2.  Ingresa tu usuario, correo o número de cuenta.
    3.  Ingresa la contraseña configurada para tu cuenta. No existe una contraseña universal incluida en el código.
*   **Recuperación de Acceso:**
    *   Si olvidas la contraseña, usa **"¿Olvidaste tu contraseña?"**.
    *   La recuperación puede realizarse mediante un enlace enviado al correo configurado o mediante un código temporal generado por el Super Admin.
    *   Los códigos son de un solo uso, tienen vencimiento y bloquean intentos repetidos.

---

## 3. Pestañas de Administración

Una vez autenticado, tendrás acceso a tres pestañas principales en la parte superior:

### 3.1. Inventario (Gestión de Productos)
Permite tener control total sobre el catálogo de productos expuestos a los clientes:
*   **Agregar Producto:** Haz clic en el botón superior **`+ Agregar Producto`**. Rellena el formulario (Nombre, Categoría, Precio, Unidad de Medida) y sube una foto.
*   **Conversión a WebP:** Cualquier imagen que subas (PNG, JPG, JPEG) será convertida automáticamente en el servidor a formato `.webp` optimizado, lo que garantiza que la página cargue ultra rápido para tus clientes y consuma pocos datos móviles.
*   **Editar Producto:** Haz clic en el ícono de **Lápiz** en la fila del producto para editar sus datos o reemplazar su fotografía.
*   **Activar/Desactivar:** Haz clic en el interruptor de estado (Ojo visible / Ojo tachado). Desactivar un producto lo oculta temporalmente del catálogo sin necesidad de borrarlo.
*   **Organizar Orden de Visualización:** Usa las flechas de ordenación para definir qué productos aparecen primero en la lista.
*   **Eliminar Producto:** Haz clic en el ícono de la **Papelera** roja para borrar el producto del catálogo permanentemente.

### 3.2. Historial de Pedidos
Registra automáticamente cada orden confirmada por los clientes:
*   **Resumen de Ventas:** En la parte superior verás un banner destacando la **Suma Total de Facturas** acumulada en tiempo real.
*   **Buscador de Pedidos:** Puedes buscar en el historial por el nombre del cliente o el número de factura.
*   **Recibos PDF:** El administrador puede volver a descargar el PDF original de cualquier pedido del historial haciendo clic en el botón de PDF.
*   **Borrar Pedido Individual:** Haz clic en el botón de la papelera roja al lado del pedido para eliminarlo del historial tras confirmar la acción.
*   **Limpiar Historial Completo:** El botón **`Limpiar Historial`** permite restablecer a cero toda la base de datos de pedidos tras confirmar el PIN de seguridad.

### 3.3. Configuración
Esta sección de ancho completo te permite configurar el comportamiento operativo del catálogo:
*   **WhatsApp para Pedidos:** Introduce el número de celular al cual deseas recibir los mensajes de WhatsApp de tus clientes (ej: formato internacional sin signos como `502XXXXXXXX`). Al hacer clic en **Actualizar Credenciales o WhatsApp**, el cambio se aplica de inmediato a todos los visitantes.
*   **Seguridad:** Actualiza tu contraseña y mantén vigente el correo asociado a la cuenta para recuperación.
*   **Temas Visuales (Personalización de Color):** Elige entre **15 colores de diseño premium** para cambiar instantáneamente la apariencia visual de la web del cliente y la administración (Verde, Azul, Rojo, Morado, Pizarra, etc.). El cambio se refleja al instante y se almacena de forma permanente.

---

## 4. Recomendaciones de Seguridad y Mantenimiento

1.  **Credenciales únicas:** Define contraseñas largas y diferentes para el Super Admin y el administrador del tenant. Guárdalas fuera del repositorio.
2.  **Imágenes de los productos:** Para que tu catálogo luzca estético y profesional, te recomendamos subir imágenes cuadradas (relación de aspecto 1:1) y con fondo claro o transparente.
3.  **Formato de Teléfono de WhatsApp:** Asegúrate de escribir el número de WhatsApp de destino con el código de tu país (ej. `502` para Guatemala) sin espacios ni símbolos adicionales (ej: `50239462142` en lugar de `+502 3946-2142`).
