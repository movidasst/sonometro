# Simulador de Sonómetro · La Movida SST+

Aplicación didáctica interactiva para que profesionales de Seguridad y Salud en el Trabajo practiquen la operación de un sonómetro: encendido, calibración de campo, configuración, medición, memoria y análisis por bandas de octava y tercios de octava.

## Funciones principales

- Acceso exclusivo para integrantes registrados de La Movida SST Plus mediante cédula y código de integrante.
- Simulación de ponderaciones A, C y Z.
- Respuestas temporales FAST, SLOW e IMPULSE.
- Nivel global, 10 bandas de octava entre 31,5 Hz y 16 kHz, y 29 bandas de tercio de octava entre 25 Hz y 16 kHz.
- Selector visible para alternar entre Global, 1/1 Octava y 1/3 Tercio; cada barra puede seleccionarse para consultar su frecuencia y nivel.
- Indicadores LAF, LAeq, Lmax y LCpeak.
- Calibración de campo, rangos, sobrecarga y memoria local.
- Tutorial inicial de tres pantallas para comprender el flujo profesional, la diferencia entre dB y Hz y la forma de aprender dentro del simulador.
- Práctica guiada de seis etapas con progreso automático: encender, verificar, configurar, medir, analizar y guardar.
- Manual integrado con buscador, acceso rápido por temas, procedimiento completo, interpretación de indicadores, comparación 1/1 vs. 1/3 de octava, errores frecuentes, glosario y atajos de teclado.
- Explicaciones contextuales de qué es, para qué sirve y cómo interpretar cada función o pantalla.
- Diseño responsivo para computadora, tableta y teléfono.

## Desarrollo local

```bash
npm install
npm run dev
```

Los archivos públicos se encuentran en `dist/`. La raíz del repositorio conserva una copia lista para GitHub Pages y el dominio `sonometro.movidasst.com`.

## Acceso y seguridad

La validación utiliza la función RPC `acceso_integrante` del proyecto oficial de Supabase y una clave pública destinada al navegador. No se incluye ninguna clave secreta o `service_role`. La aplicación no almacena la cédula ni la clave del integrante; mantiene únicamente el nombre durante una sesión temporal.

## Enlaces

- Laboratorio de Higiene Ocupacional: https://www.labho.movidasst.com
- Registro: https://registro.movidasst.com
- Canal de WhatsApp: https://whatsapp.com/channel/0029Va0mlH5Jf05mrcCz8r3e
- La Movida SST: https://www.movidasst.com

## Autor

Elaborado por **David Linares Brea**  
info@movidasst.com · +56 9 6861 5650

> Recurso educativo. No sustituye un sonómetro Clase 1 o Clase 2 ni una evaluación profesional de ruido ocupacional.
