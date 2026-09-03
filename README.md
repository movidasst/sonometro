# Simulador de Sonómetro · La Movida SST+

Aplicación didáctica interactiva para que profesionales de Seguridad y Salud en el Trabajo practiquen la operación de un sonómetro: encendido, calibración de campo, configuración, medición, memoria y análisis por bandas de octava y tercios de octava.

## Funciones principales

- Acceso exclusivo para integrantes registrados de La Movida SST Plus mediante cédula y código de integrante.
- Simulación de ponderaciones A, C y Z.
- Respuestas temporales FAST, SLOW e IMPULSE.
- Nivel global, bandas de octava y tercios de octava.
- Indicadores LAF, LAeq, Lmax y LCpeak.
- Calibración de campo, rangos, sobrecarga y memoria local.
- Tutorial guiado y explicaciones de qué es, para qué sirve y cómo interpretar cada función.
- Diseño responsivo para computadora, tableta y teléfono.

## Desarrollo local

```bash
npm install
npm run dev
```

Los archivos públicos se encuentran en `dist/`.

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
