"""Create controlled multi-page inputs and a separate expected-data manifest."""
import argparse
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/pdf/regresion-documental/20260906-r09'
PURCHASE = [
    ('00001-TPBI', 'TAPA TARRO CUADRADO BLANCO (60 UNID)', 37, 'und'),
    ('00006-TRP', 'TARRO CUADRADO x 60', 43, 'und'),
    ('00017-ETASH60', 'ETIQUETA ASHWAGANDHA x 60', 29, 'und'),
    ('00035-LNTP60', 'LINER TARRO x 60', 41, 'und'),
    ('00018-ETBOS60', 'ETIQUETA BOOSTER x 60', 31, 'und'),
    ('00003-TPGG', 'TAPA TARRO GRANDE GRIS x 120', 47, 'und'),
    ('00007-TRG', 'TARRO GRANDE PRICESMART x 120', 53, 'und'),
    ('00036-LNTG120', 'LINER TARRO GRANDE x 120', 59, 'und'),
    ('00042-CMCG', 'CAJA MASTER CREA GUMS x 24', 17, 'und'),
    ('00040-CMV', 'CAJA MASTER VINAGRE x 24', 19, 'und'),
    ('00051-MPASH', 'GOMAS ASHWAGANDHA - MAGNESIO Y VITAMINA C', 8750, 'g'),
]
EXIT = [
    ('00001-TPBI', 'TAPA TARRO CUADRADO BLANCO (60 UNID)', 23, 'und'),
    ('00006-TRP', 'TARRO CUADRADO x 60', 23, 'und'),
    ('00018-ETBOS60', 'ETIQUETA BOOSTER x 60', 17, 'und'),
    ('00035-LNTP60', 'LINER TARRO x 60', 17, 'und'),
    ('00015-ETRESI60', 'ETIQUETA RESVERATROL x 60', 19, 'und'),
    ('00003-TPGG', 'TAPA TARRO GRANDE GRIS x 120', 31, 'und'),
    ('00007-TRG', 'TARRO GRANDE PRICESMART x 120', 31, 'und'),
    ('00036-LNTG120', 'LINER TARRO GRANDE x 120', 31, 'und'),
    ('00026-ETRES120', 'ETIQUETA RESVERATROL x 120', 29, 'und'),
]


def build(kind, rows, run='20260906-R09'):
    purchase = kind == 'OC'
    reference = f'QA-DOC-{run}-{kind}-001'
    path = OUTPUT / f'{reference}.pdf'
    if path.exists():
        raise FileExistsError(f'No se sobrescribe evidencia existente: {path}')
    styles = getSampleStyleSheet()
    styles['BodyText'].fontSize = 9
    styles['BodyText'].leading = 12
    title = 'ORDEN DE COMPRA' if purchase else 'SALIDA DE BODEGA HACIA 3Q'
    doc = SimpleDocTemplate(str(path), pagesize=landscape(A4),
                            leftMargin=15*mm, rightMargin=15*mm,
                            topMargin=15*mm, bottomMargin=17*mm)
    story = []
    expected = []
    for i, (sku, name, quantity, unit) in enumerate(rows):
        expected.append(dict(sku=sku, descripcion=name, cantidad=quantity, unidad=unit,
                             lote=f'QA-{run.rsplit("-", 1)[-1]}-{sku}' if purchase else None,
                             vencimiento='2028-12-31' if purchase else None))
    for start in range(0, len(rows), 6):
        if start:
            story.append(PageBreak())
        story += [Paragraph(title, styles['Title']),
                  Paragraph(f'<b>Referencia:</b> {reference} | <b>Fecha:</b> 2026-09-06', styles['BodyText']),
                  Paragraph('Proveedor: PROVEEDOR QA MULTISKU SAS | NIT: 901555777-3' if purchase
                            else 'Destinatario: 3Q - MAQUILA EXTERNA QA | NIT: 900333222-1', styles['BodyText']),
                  Paragraph('Lugar de entrega: BODEGA PRINCIPAL - BOGOTA D.C. | Moneda: COP' if purchase
                            else 'Entrega: SOFI - PERFIL QA | Recibe: PENDIENTE DE FIRMA | Ciudad: Bogota D.C.', styles['BodyText']),
                  Spacer(1, 7*mm)]
        headings = ['SKU', 'Descripcion', 'Cantidad', 'Unidad'] + (['Lote', 'Vencimiento'] if purchase else [])
        data = [[Paragraph(f'<b>{value}</b>', styles['BodyText']) for value in headings]]
        for row in expected[start:start+6]:
            values = [row['sku'], row['descripcion'], row['cantidad'], row['unidad']]
            if purchase:
                values += [row['lote'], row['vencimiento']]
            data.append([Paragraph(str(value), styles['BodyText']) for value in values])
        widths = [35, 85, 22, 18, 65, 30] if purchase else [42, 143, 35, 35]
        table = Table(data, colWidths=[value*mm for value in widths], repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e6edf3')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#a8b2bc')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ]))
        story += [table, Spacer(1, 5*mm), Paragraph(
            'Verificar lote, vencimiento y cantidades contra la mercancia fisica.' if purchase
            else 'Lotes y vencimientos no declarados en esta salida documental.', styles['BodyText'])]

    def footer(canvas, document):
        canvas.setFont('Helvetica', 8)
        canvas.drawString(15*mm, 9*mm, 'WMS QA - Documento de prueba sin validez comercial')
        canvas.drawRightString(282*mm, 9*mm, f'Pagina {document.page}')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(path)
    return dict(referencia=reference, tipo=kind, archivo=path.name, items=expected)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', default='20260906-R09')
    parser.add_argument('--kind', choices=['OC', 'SALIDA-3Q', 'both'], default='both')
    parser.add_argument('--quantity-offset', type=int, default=0)
    args = parser.parse_args()
    run = args.run.upper().strip()
    if not run or len(run) > 30 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' for c in run):
        raise ValueError('Referencia de corrida invalida')
    OUTPUT = ROOT / 'output/pdf/regresion-documental' / run.lower()
    selected = [('OC', PURCHASE), ('SALIDA-3Q', EXIT)]
    selected = [(kind, [(sku, name, qty + args.quantity_offset, unit) for sku, name, qty, unit in rows])
                for kind, rows in selected if args.kind in ('both', kind)]
    if any(qty <= 0 for _, rows in selected for _, _, qty, _ in rows):
        raise ValueError('Las cantidades deben ser positivas')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if (OUTPUT / 'expected.json').exists():
        raise FileExistsError('La corrida ya tiene manifiesto; usar otra referencia')
    documents = [build(kind, rows, run) for kind, rows in selected]
    (OUTPUT / 'expected.json').write_text(json.dumps(documents, indent=2), encoding='utf-8')
