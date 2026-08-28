import smtplib
from email.message import EmailMessage
import os
import sys
import json
import urllib.request
from datetime import datetime, date, timezone

# credenciales del correo
correo = "rafadevhead@gmail.com"
password = "hslrounuujuljkpc"

# destinatarios de correo
destinatarios = [
    "aux_suministros@headingenieria.mx",
    "rafaelheading@gmail.com",
    # "jacqueline@headingenieria.mx",
    # "yuryko@headingenieria.mx",
    # "edgar@headingenieria.mx"
]

# Configuración de Supabase
SUPABASE_URL = "https://djjgtydhqtykxgvevnsg.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_hxtIHeGV-8thmt-om1vwfg_BIy9CAkd"

def enviar_correo(almacen, fecha_pago, dias_restantes, producto, orden_compras, destinatario):
    msg = EmailMessage()
    msg['From'] = correo
    if isinstance(destinatario, (list, tuple)):
        msg['To'] = ", ".join(destinatario)
    else:
        msg['To'] = destinatario
    msg['Subject'] = f"renta proxima a vencer del almacen {almacen}"
    msg.set_content(f"renta proxima a vencer del almacen {almacen}, el producto {producto} con orden de compra {orden_compras} tiene fecha de pago: {fecha_pago}, dias restantes: {dias_restantes}")

    try:
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(correo, password)
        server.send_message(msg)
        server.quit()
        print(f"Correo enviado exitosamente para almacén {almacen}")
        return True
    except Exception as e:
        print(f"Error al enviar el correo: {e}")
        return False

def procesar_alertas():
    print("Iniciando procesamiento automático de alertas de rentas...")
    
    # 1. Obtener almacenes para mapear warehouse_id a nombre legible
    req_wh = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/warehouses?select=id,name",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
        }
    )
    
    almacenes = {}
    try:
        with urllib.request.urlopen(req_wh) as res:
            wh_data = json.loads(res.read().decode())
            for wh in wh_data:
                almacenes[wh['id']] = wh['name']
    except Exception as e:
        print(f"Error al obtener almacenes: {e}")
        return

    # 2. Obtener rentas con estado ACTIVA y sin alerta enviada
    req_rentas = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rentas?select=*&estado=eq.ACTIVA&alerta_enviada=eq.false",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
        }
    )
    
    try:
        with urllib.request.urlopen(req_rentas) as res:
            rentas = json.loads(res.read().decode())
    except Exception as e:
        print(f"Error al obtener rentas: {e}")
        return

    hoy = date.today()
    print(f"Fecha de hoy: {hoy}")
    print(f"Se encontraron {len(rentas)} rentas activas no notificadas.")
    
    for renta in rentas:
        fecha_pago_str = renta.get("fecha_pago")
        if not fecha_pago_str:
            continue
            
        try:
            fecha_pago = datetime.strptime(fecha_pago_str, "%Y-%m-%d").date()
        except ValueError:
            print(f"Error parseando fecha para renta ID {renta.get('id')}: {fecha_pago_str}")
            continue
            
        dias_restantes = (fecha_pago - hoy).days
        cliente = renta.get("cliente", "Cliente Desconocido")
        print(f"Evaluando renta de {cliente}: {dias_restantes} días restantes (Fecha Pago: {fecha_pago_str})")
        
        # Alerta: 7 días o menos
        if dias_restantes <= 7:
            wh_id = renta.get("warehouse_id")
            nom_almacen = almacenes.get(wh_id, "Almacén Desconocido")
            producto = renta.get("descripcion") or "Sin descripción"
            orden_compra = renta.get("orden_compra") or "Sin orden"
            
            exito = enviar_correo(
                almacen=nom_almacen,
                fecha_pago=fecha_pago_str,
                dias_restantes=dias_restantes,
                producto=producto,
                orden_compras=orden_compra,
                destinatario=destinatarios
            )
            
            if exito:
                # Actualizar alerta_enviada = true en Supabase
                renta_id = renta.get("id")
                updated_at_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                req_update = urllib.request.Request(
                    f"{SUPABASE_URL}/rest/v1/rentas?id=eq.{renta_id}",
                    headers={
                        "apikey": SUPABASE_ANON_KEY,
                        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal"
                    },
                    data=json.dumps({
                        "alerta_enviada": True,
                        "updated_at": updated_at_str
                    }).encode(),
                    method="PATCH"
                )
                try:
                    with urllib.request.urlopen(req_update) as _:
                        print(f"Alerta marcada como enviada en Supabase para renta ID {renta_id} ({cliente})")
                except Exception as e:
                    print(f"Error al actualizar estado en Supabase para renta ID {renta_id}: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Modo manual con parámetros JSON (para pruebas rápidas de envío)
        try:
            params = json.loads(sys.argv[1])
            enviar_correo(
                almacen=params.get("almacen", "Almacen Central"),
                fecha_pago=params.get("fecha_pago", "2026-09-30"),
                dias_restantes=params.get("dias_restantes", 5),
                producto=params.get("producto", "plataforma"),
                orden_compras=params.get("orden_compra", "1234567890"),
                destinatario=params.get("destinatario", destinatarios)
            )
        except Exception as e:
            print(f"Error al procesar parámetros JSON manuales: {e}")
            sys.exit(1)
    else:
        # Modo autónomo automático
        procesar_alertas()