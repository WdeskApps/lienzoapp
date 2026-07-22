# Code Review — `app.js` (LienzoApp)
**Fecha de revisión:** 22 de Julio de 2026  
**Revisor:** Antigravity AI  
**Proyecto:** LienzoApp — Pizarrón Infinito y Mapas Mentales (Vanilla JS + Rough.js)

---

## 1. Resumen Ejecutivo

`app.js` es un monolito de ~2.780 líneas de JavaScript puro (Vanilla JS) que implementa un motor completo de pizarra infinita de alto nivel sin dependencias de frameworks. Gestiona renderizado SVG dinámico, capas multitrazado, reconocimiento de gestos a mano alzada, simulación de físicas simples (cuerda/estabilizador), soporte multi-día vía `localStorage`, importación/exportación con sanitización profunda y exportación a canvas/PNG.

En general, el código destaca por su **excelente estructura funcional**, comentarios explicativos claros, **sanitización defensiva sólida** para evitar vulnerabilidades XSS/RCE al importar datos externos, y una implementación elegante de gestos multitáctiles (*pinch-to-zoom*).

A continuación se detallan los puntos fuertes, posibles bugs/riesgos de compatibilidad y oportunidades de mejora identificadas.

---

## 2. Puntos Fuertes y Buenas Prácticas

1. **Sanitización Defensiva de Datos (`sanitizeBoard`)**:
   - Excelente validación de tipos, límites numéricos (`sanNum`), expresiones regulares para colores hexadecimales (`sanColor`) y formato seguro para `dataURL` de imágenes (`sanDataUrl`). Protege la aplicación contra archivos JSON corruptos o maliciosos.
2. **Exportación a PNG con renderizado nativo `<text>`**:
   - Evita la contaminación del Canvas (*canvas tainting*) producida por elementos `<foreignObject>` en navegadores basados en Chromium, reemplazándolos temporalmente por elementos nativos `<text>` y `<tspan>` durante el cálculo del exportable.
3. **Gestión de Gestos Multitáctiles (`pinch-to-zoom`)**:
   - Mantiene una lista de toques activos (`touches` Map) a nivel global de ventana, lo que garantiza un control fluido del zoom con dos dedos sin perder captura cuando los dedos pasan sobre nodos o trazos SVG.
4. **Algoritmia Limpia**:
   - Uso efectivo de simplificación de curvas Ramer-Douglas-Peucker (`rdp`), algoritmo de Shoelace para áreas, y BFS con detección de in-degree para el renderizado del grafo visual y el colapso de ramas en árboles con ciclos.

---

## 3. Posibles Bugs y Riesgos de Compatibilidad

### 🔴 Alto / Medio Riesgo

1. **Uso de APIs obsoletas (`document.execCommand`)**
   - **Ubicación:** Línea ~1037 (`document.execCommand('insertText', ...)` en el evento `paste`) y Línea ~1067 (`document.execCommand('selectAll', ...)` en el foco).
   - **Riesgo:** `document.execCommand` es una API declarada *deprecated* por el estándar W3C. Aunque los navegadores aún le dan soporte retrocompatible, puede ser eliminada o comportarse de forma inconsistente en futuras versiones del navegador.
   - **Solución recomendada:** Reemplazar por la API moderna `Selection` y `Range` (`window.getSelection()`, `range.deleteContents()`, etc.).

2. **Riesgo de Agotamiento de `localStorage` por Imágenes Base64**
   - **Ubicación:** `saveLocal()`, `addPastedImage()`.
   - **Riesgo:** `localStorage` tiene un límite estricto de ~5 MB por origen. Las imágenes en formato DataURL Base64 consumen rápidamente este espacio. Aunque existe un control con `quotaWarned` y compresión de imagen, guardar múltiples días con imágenes puede causar que `localStorage.setItem` falle silenciosamente o bloquee nuevos guardados.
   - **Solución recomendada:** Migrar el almacenamiento de imágenes o de los snapshots diarios a **IndexedDB**, utilizando `localStorage` únicamente para configuraciones ligeras de usuario.

3. **Reconstrucción Completa del DOM en la Capa UI durante el Arrastre (`renderUILayer`)**
   - **Ubicación:** `renderUILayer()` (Línea ~1091).
   - **Riesgo:** `uiLayer.innerHTML = ''` vacía y vuelve a crear todos los botones de colapso, badges, botones de GIF y la caja de selección en cada frame de movimiento/zoom. Esto genera presión sobre el Recolector de Basura (*Garbage Collector*) y posibles parpadeos o micro-stuttering en tableros grandes.
   - **Solución recomendada:** Reutilizar o actualizar las posiciones de los elementos existentes en lugar de destruir y recrear el DOM de `uiLayer` en cada ciclo de `render()`.

---

## 4. Oportunidades de Mejora y Rendimiento

1. **Modularización y Encapsulamiento del Scope Global**:
   - Actualmente, más de 35 variables globales (`nodes`, `links`, `strokes`, `view`, `selection`, `currentTool`, etc.) residen en el *scope* global del navegador.
   - **Mejora:** Envolver el código en un módulo de ES6 (`type="module"`) o dentro de una IIFE `(function() { ... })()` para evitar colisiones con scripts externos o extensiones del navegador.

2. **Optimización de Snapshots de Historial (`snapshot()`)**:
   - `snapshot()` serializa todo el estado de la aplicación a una cadena JSON masiva (`JSON.stringify`) incluso cuando el lienzo contiene miles de puntos de trazo a mano alzada.
   - **Mejora:** Implementar un historial basado en parches del delta de cambios (*Command Pattern* / *Undo Stack*) en lugar de clonar el estado completo del pizarrón.

3. **Accesibilidad (a11y)**:
   - Los elementos interactivos dentro de SVG y los controles flotantes carecen de etiquetas `aria-label` y roles accesibles para lectores de pantalla.
   - **Mejora:** Añadir `aria-label` descriptivos a los botones del dock flotante y soportar navegación por teclado completa para personas con movilidad reducida.

---

## 5. Resumen de Recomendaciones Priorizadas

| Prioridad | Área | Descripción |
| :--- | :--- | :--- |
| **Alta** | Compatibilidad | Sustituir `document.execCommand` por `Selection` / `Range` API. |
| **Media** | Almacenamiento | Planificar migración a **IndexedDB** para los datos de pizarras e imágenes. |
| **Media** | Rendimiento | Evitar `innerHTML = ''` continuo en `uiLayer` durante eventos de arrastre. |
| **Baja** | Arquitectura | Encapsular variables globales en un módulo ES6 o IIFE. |

---

*Revisión realizada automáticamente por Antigravity IDE.*
