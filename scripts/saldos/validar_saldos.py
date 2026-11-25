"""Valida el Excel de saldos iniciales del cliente. No escribe en la base.

Uso: python scripts/saldos/validar_saldos.py archivo.xlsx [--salida filas.json]
Hoja «Inventario»: nombre, código, inicial, entrada, salida, stock actual (datos desde la fila 9).
Hoja «Lotes» (opcional) con encabezados CODIGO, LOTE, VENCIMIENTO, CANTIDAD, UBICACION.
Sale con código 1 si hay errores que impiden cargar.
"""
import argparse, datetime as dt, json, pathlib, re, sys
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[2]
FUENTES = ('database/05_infinity_product_catalog.sql', 'database/acta_5_2_master_data.json',
           'data/product-operational-settings-20260921.json')


def catalogo():
    # Copia local: los productos creados después en el WMS no aparecen aquí.
    texto = '\n'.join((ROOT / f).read_text(encoding='utf-8') for f in FUENTES)
    return set(re.findall(r"""['"]([^'"\n]+)['"]""", texto))


def numero(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def exige_lote(codigo, nombre):
    if codigo.endswith('-PTLUM'):  # aparato sin lote ni vencimiento
        return False
    n = nombre.upper()
    return bool(re.search(r'-\s*(MP|PT)', codigo)) or n.startswith(('GOMAS', 'PRODUCTO TERM'))


def validar(libro, codigos):
    errores, avisos, saldos, vistos = [], [], {}, {}
    if 'Inventario' not in libro.sheetnames:
        return ['No existe la hoja «Inventario»'], [], []
    for i, r in enumerate(libro['Inventario'].iter_rows(min_row=9, max_col=6, values_only=True), 9):
        nombre, codigo = str(r[0] or '').strip(), str(r[1] or '').strip()
        if not nombre:
            continue
        e = lambda m: errores.append(f'Fila {i} {nombre}: {m}')
        stock = numero(r[5])
        if stock is None:
            e('stock actual vacío o no numérico'); continue
        if stock < 0:
            e(f'stock negativo ({stock:g})'); continue
        inicial, entrada, salida = (numero(x) or 0 for x in r[2:5])
        if abs(inicial + entrada - salida - stock) > 0.01:
            avisos.append(f'Fila {i} {nombre}: stock {stock:g}, la fila da {inicial + entrada - salida:g}')
        if not codigo:
            (e if stock else lambda m: avisos.append(f'Fila {i} {nombre}: {m}'))('sin código'); continue
        if codigo in vistos:
            e(f'código {codigo} repetido (fila {vistos[codigo]})'); continue
        vistos[codigo] = i
        if codigo not in codigos:
            avisos.append(f'Fila {i} {nombre}: {codigo} no está en el catálogo del repo; confirmar en el WMS')
        if stock:
            saldos[codigo] = (nombre, stock)

    filas, sumas, claves = [], {}, set()
    if 'Lotes' in libro.sheetnames:
        datos = libro['Lotes'].iter_rows(values_only=True)
        cab = [str(c or '').strip().upper() for c in next(datos, ())]
        if faltan := [c for c in ('CODIGO', 'LOTE', 'VENCIMIENTO', 'CANTIDAD') if c not in cab]:
            errores.append(f'Lotes: faltan columnas {", ".join(faltan)}')
        else:
            for i, r in enumerate(datos, 2):
                f = dict(zip(cab, r))
                if not any(v is not None for v in r):
                    continue
                codigo, lote = str(f['CODIGO'] or '').strip(), str(f['LOTE'] or '').strip()
                cant, vence = numero(f['CANTIDAD']), f['VENCIMIENTO']
                ubic = str(f.get('UBICACION') or '').strip()
                mal = []
                if codigo not in saldos: mal.append(f'código {codigo or "vacío"} sin saldo')
                if not lote: mal.append('sin lote')
                if not cant or cant < 0: mal.append('cantidad inválida')
                if not isinstance(vence, dt.datetime) or not 2025 <= vence.year <= 2035: mal.append('vencimiento inválido')
                if (codigo, lote, ubic) in claves: mal.append(f'lote {lote} repetido')
                if mal:
                    errores.append(f'Lotes fila {i}: ' + '; '.join(mal)); continue
                claves.add((codigo, lote, ubic))
                if vence.date() < dt.date.today(): avisos.append(f'Lotes fila {i}: {lote} vencido')
                sumas[codigo] = sumas.get(codigo, 0) + cant
                filas.append(dict(codigo=codigo, lote=lote, vencimiento=vence.date().isoformat(),
                                  cantidad=cant, ubicacion=ubic or None))
    for codigo, (nombre, stock) in saldos.items():
        if codigo in sumas:
            if abs(sumas[codigo] - stock) > 0.01:
                errores.append(f'{nombre} ({codigo}): lotes suman {sumas[codigo]:g} y el stock es {stock:g}')
        elif exige_lote(codigo, nombre):
            errores.append(f'{nombre} ({codigo}): faltan lotes para {stock:g}')
        else:
            filas.append(dict(codigo=codigo, lote=None, vencimiento=None, cantidad=stock, ubicacion=None))
    return errores, avisos, filas


def main():
    p = argparse.ArgumentParser()
    p.add_argument('archivo'); p.add_argument('--salida')
    a = p.parse_args()
    errores, avisos, filas = validar(openpyxl.load_workbook(a.archivo, data_only=True), catalogo())
    for titulo, lista in (('ERRORES', errores), ('AVISOS', avisos)):
        print(f'{titulo}: {len(lista)}')
        for x in lista: print('  -', x)
    print(f'Filas listas: {len(filas)}')
    if a.salida and not errores:
        pathlib.Path(a.salida).write_text(json.dumps(filas, ensure_ascii=False, indent=1), encoding='utf-8')
    return 1 if errores else 0


if __name__ == '__main__':
    sys.exit(main())
