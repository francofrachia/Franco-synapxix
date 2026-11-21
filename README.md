# Informe Técnico de Planificación y Alcance: Sistema de Movimiento del Autómata (Rol A)
 
**Fecha:** 20 de noviembre de 2026  
**Proyecto:** Synapxix — Prototipo Web HD-2D (Primera Etapa)  
**Módulo Asignado:** Rol A: Lógica de Movimiento, Navegación Isométrica, Cámara y Accesibilidad (*El Autómata*)

---

## 1. Resumen Ejecutivo y Delimitación de Alcance

Este documento establece la planificación técnica, herramientas de desarrollo, arquitectura de software y estado de entrega correspondiente al **sistema de locomoción y control del personaje principal: El Autómata**.

El objetivo es proveer un controlador de movimiento táctil por baldosas en perspectiva isométrica ($32 \times 16$), desacoplado del motor gráfico, que resuelva navegación mediante búsqueda de caminos óptimos (algoritmo A*), detección estricta de colisiones con el entorno, selección de poses direccionales, seguimiento cinemático de cámara y cumplimiento riguroso de las pautas de accesibilidad para público infantil (Sección 7 del documento de diseño: contrastes obligatorios, hitboxes físicas independientes y feedback no punitivo).

> **Delimitación de responsabilidades:** Mi alcance se concentra íntegramente en el cerebro matemático y de traslación del personaje (`AutomataController`), la resolución de poses, la cámara de seguimiento, las pruebas unitarias y la capa de telemetría D.A.L.A. asociada a la interacción táctil (`tap_missed`, `session_started`). El modelado estructural definitivo del escenario en Tiled/3D, la iluminación de la cueva y la redacción/disparo de diálogos quedan fuera de mi responsabilidad directa, consumiéndose a través de interfaces desacopladas listas para integración.

---

## 2. Herramientas y Stack Tecnológico del Módulo

Para garantizar máxima modularidad, rendimiento a 60 FPS y testeabilidad automatizada sin dependencias de hardware o navegadores, el desarrollo se estructura bajo las siguientes herramientas:

| **Categoría** | **Herramienta** | **Aplicación Específica en el Módulo** |
| :--- | :--- | :--- |
| **Lógica Core y Navegación** | **TypeScript Puro (Decoupled)** | Implementación del controlador `AutomataController` y algoritmo A* sin importar librerías visuales, asegurando que funcione sobre cualquier mapa o motor. |
| **Motor de Render e Integración** | **Angular + Phaser 4** | Inicialización del canvas en `/spike/pasillo`, renderizado de sprites con escala entera $\times 4$ ($480 \times 270 \to 1920 \times 1080$) y filtro *Nearest Neighbor*. |
| **Cámara y Viewport** | **Phaser Camera System** | Configuración de seguimiento suave (*lerp* 0.1) con restricción rígida a los límites del mapa (*world bounds*) y bandas de soporte *letterbox* (`#263647`). |
| **Testing y Calidad** | **Jest + Nx CLI** | Batería de pruebas unitarias automatizadas para validar traslación, esquive de obstáculos, cálculo de rumbos y estados del autómata sin levantar entorno gráfico. |
| **Arte y Sprites** | **Atlas Multus (JSON / PNG)** | Resolución y mapeo dinámico de las 4 orientaciones base (`automata_0`, `1`, `3`, `4`) con rebote vertical rítmico de paso ($1\text{ px}$ cada $130\text{ ms}$). |

---

## 3. Arquitectura de Archivos y Rutas Bajo mi Responsabilidad

Dentro de la arquitectura del proyecto (`web-game/src/app/`), el trabajo se concentra en los siguientes módulos, dejando un contrato limpio para conectar con el mapa de los compañeros:

```text
web-game/src/app/
├── spike-nodo1/
│   ├── pasillo-automata.ts       # [MÍO] Controlador desacoplado: A*, cola de pasos, rumbos, poses y rebote
│   ├── pasillo-automata.spec.ts  # [MÍO] Suite de 82 tests unitarios (colisiones, pathfinding, escalado)
│   ├── pasillo-map.ts            # [MÍO] Modelo greybox (14x7), colisiones y contrato de transitabilidad
│   ├── pasillo-logger.ts         # [MÍO] Telemetría D.A.L.A. centralizada (session_started, tap_missed, momentos)
│   ├── pasillo-world.ts          # [MÍO] Escena Phaser: cámara follow, outline de accesibilidad, sombra y render
│   ├── pasillo-spike.component.ts# [MÍO] Envoltorio Angular standalone montado en /spike/pasillo
│   ├── world.ts                  # [HEREDADO / CRUCE] Escena del spike anterior (referencia matemática)
│   └── iso.ts                    # [COMPARTIDO] Utilidades geométricas isométricas base (2:1)
└── app.routes.ts                 # [MÍO] Registro de la ruta activa /spike/pasillo
```

> **Nota de integración con el Entorno (Cueva / Pasillo):**  
> Para integrarse con el mapa final que prepara el equipo de entorno, `AutomataController` solo requiere una función booleana `isWalkable(gx, gy)` y un punto de inicio (`spawnPoint`). Todo el cálculo de rutas, giros y cámara se adapta de forma inmediata sin necesidad de reescribir la lógica del personaje.

---

## 4. Hoja de Ruta y Desglose de Tareas

El desarrollo del módulo se completó y organizó en cuatro fases técnicas:

1. **Fase 1: Controlador Desacoplado y Matemáticas de Movimiento**
   - Independización de la lógica del caminante fuera del ciclo interno de Phaser hacia `pasillo-automata.ts`.
   - Implementación de la cola de waypoints y cálculo dinámico de rumbos en 4 orientaciones según el vector de avance.
   - Creación del rebote vertical procedural de paso ($1\text{ px}$) para evitar la sensación de deslizamiento rígido.

2. **Fase 2: Banco de Pruebas (Greybox) y Colisiones**
   - Construcción del entorno greybox de $14 \times 7$ baldosas con obstáculos de chatarra, monolito y meta temporal.
   - Integración de la heurística A* para esquivar esquinas y obstáculos en tiempo real sin cortar diagonales bloqueadas.
   - Elaboración de la suite de pruebas automatizadas con validación del 100% de los casos de prueba.

3. **Fase 3: Accesibilidad Visual y Cámara (Reglas Sección 7)**
   - Configuración de la cámara con seguimiento cinemático suave (*lerp* 0.1) restringida a las dimensiones de la sala.
   - Implementación del contorno claro permanente (`#E0DCD3`) mediante técnica multicapa para asegurar contraste sobre suelos oscuros.
   - Incorporación de sombra elíptica fija y ordenamiento de profundidad $Y$ sincronizado entre sprite, outline y sombra al pasar tras obstáculos.
   - Señalización interactiva del destino con rombo amarillo de alto contraste (`#FFDA39`).

4. **Fase 4: Telemetría D.A.L.A. y Dependencias de Arte**
   - Implementación de hitboxes táctiles ampliadas ($> 2 \times 2\text{ cm}$) desacopladas del sprite visual.
   - Registro de toques fallidos (`tap_missed`) con indicador en rosa suave (`#FB7B88`) respetando la regla de "sin castigo visual".
   - Formalización del requerimiento para Multus: especificación de la necesidad del *walk cycle* fotograma a fotograma si se busca animación cuadro a cuadro completa.
