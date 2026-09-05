from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "output" / "pdf" / "regresion-documental"

ORANGE = colors.HexColor("#F58634")
INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#526173")
LINE = colors.HexColor("#CCD4DD")
PALE = colors.HexColor("#F4F6F8")


PURCHASE_ITEMS = [
    ("00001-TPBI", "TAPA TARRO CUADRADO BLANCO (60 UNID)", 37, "und", "QA-TPBI-260905", "2028-01-31"),
    ("00006-TRP", "TARRO CUADRADO x 60", 43, "und", "QA-TRP-260905", "2028-02-29"),
    ("00017-ETASH60", "ETIQUETA ASHWAGANDHA x 60", 29, "und", "QA-ETASH60-260905", "2028-03-31"),
    ("00035-LNTP60", "LINER TARRO x 60", 41, "und", "QA-LNTP60-260905", "2028-04-30"),
    ("00018-ETBOS60", "ETIQUETA BOOSTER x 60", 31, "und", "QA-ETBOS60-260905", "2028-05-31"),
    ("00003-TPGG", "TAPA TARRO GRANDE GRIS x 120", 47, "und", "QA-TPGG-260905", "2028-06-30"),
    ("00007-TRG", "TARRO GRANDE PRICESMART x 120", 53, "und", "QA-TRG-260905", "2028-07-31"),
    ("00036-LNTG120", "LINER TARRO GRANDE x 120", 59, "und", "QA-LNTG120-260905", "2028-08-31"),
    ("00042-CMCG", "CAJA MASTER CREA GUMS x 24", 17, "und", "QA-CMCG-260905", "2028-09-30"),
    ("00040-CMV", "CAJA MASTER VINAGRE x 24", 19, "und", "QA-CMV-260905", "2028-10-31"),
    ("00051-MPASH", "GOMAS ASHWAGANDHA - MAGNESIO Y VITAMINA C", 8750, "g", "QA-MPASH-260905", "2027-12-15"),
]

OUTSOURCING_ITEMS = [
    ("00001-TPBI", "TAPA TARRO CUADRADO BLANCO (60 UNID)", 23, "und"),
    ("00006-TRP", "TARRO CUADRADO x 60", 23, "und"),
    ("00018-ETBOS60", "ETIQUETA BOOSTER x 60", 17, "und"),
    ("00035-LNTP60", "LINER TARRO x 60", 17, "und"),
    ("00015-ETRESI60", "ETIQUETA RESVERATROL x 60", 19, "und"),
    ("00003-TPGG", "TAPA TARRO GRANDE GRIS x 120", 31, "und"),
    ("00007-TRG", "TARRO GRANDE PRICESMART x 120", 31, "und"),
    ("00036-LNTG120", "LINER TARRO GRANDE x 120", 31, "und"),
    ("00026-ETRES120", "ETIQUETA RESVERATROL x 120", 29, "und"),
]


def paragraph(text, style):
    return Paragraph(str(text), style)


def base_styles():
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=19,
            leading=22,
            textColor=INK,
            alignment=TA_LEFT,
            spaceAfter=3 * mm,
        ),
        "meta": ParagraphStyle(
            "Meta",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=11,
            textColor=INK,
        ),
        "cell": ParagraphStyle(
            "Cell",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.2,
            leading=9,
            textColor=INK,
        ),
        "cell_bold": ParagraphStyle(
            "CellBold",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.2,
            leading=9,
            textColor=INK,
        ),
        "header": ParagraphStyle(
            "Header",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.2,
            leading=9,
            textColor=colors.white,
        ),
        "right": ParagraphStyle(
            "Right",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11,
            textColor=INK,
            alignment=TA_RIGHT,
        ),
        "foot": ParagraphStyle(
            "Foot",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=10,
            textColor=MUTED,
        ),
    }


def page_header(canvas, doc):
    canvas.saveState()
    width, height = landscape(A4)
    canvas.setFillColor(ORANGE)
    canvas.rect(0, height - 7 * mm, width, 7 * mm, stroke=0, fill=1)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(doc.leftMargin, 8 * mm, "WMS QA - Documento controlado para pruebas de lectura documental")
    canvas.drawRightString(width - doc.rightMargin, 8 * mm, f"Pagina {doc.page}")
    canvas.restoreState()


def metadata_table(rows, styles):
    data = []
    for left_label, left_value, right_label, right_value in rows:
        data.append([
            paragraph(f"<b>{left_label}</b><br/>{left_value}", styles["meta"]),
            paragraph(f"<b>{right_label}</b><br/>{right_value}", styles["meta"]),
        ])
    table = Table(data, colWidths=[126 * mm, 126 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
    ]))
    return table


def data_table(headers, rows, widths, styles):
    data = [[paragraph(header, styles["header"]) for header in headers]]
    data.extend([
        [paragraph(value, styles["cell_bold"] if index == 0 else styles["cell"]) for index, value in enumerate(row)]
        for row in rows
    ])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ("ALIGN", (2, 1), (2, -1), "RIGHT"),
    ]))
    return table


def build_purchase_order(path):
    styles = base_styles()
    doc = SimpleDocTemplate(
        str(path),
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=15 * mm,
        bottomMargin=14 * mm,
        title="Orden de compra QA multireferencia",
        author="WMS QA",
    )
    und_total = sum(row[2] for row in PURCHASE_ITEMS if row[3] == "und")
    gram_total = sum(row[2] for row in PURCHASE_ITEMS if row[3] == "g")
    story = [
        paragraph("ORDEN DE COMPRA - PRUEBA DOCUMENTAL MULTIREFERENCIA", styles["title"]),
        metadata_table([
            ("Numero de OC", "QA-DOC-20260905-OC-MULTI-001", "Fecha de orden", "2026-09-05"),
            ("Proveedor", "PROVEEDOR QA MULTISKU SAS", "NIT proveedor", "901555777-3"),
            ("Moneda", "COP", "Lugar de entrega", "BODEGA PRINCIPAL - BOGOTA D.C."),
            ("Comprador", "INFINITY BRANDS - ENTORNO QA", "Contacto", "recepcion.qa@wms.local"),
        ], styles),
        Spacer(1, 5 * mm),
        data_table(
            ["SKU", "Producto / insumo", "Cantidad", "Unidad", "Lote proveedor", "Vencimiento"],
            [[sku, name, str(quantity), unit, lot, expiry] for sku, name, quantity, unit, lot, expiry in PURCHASE_ITEMS],
            [32 * mm, 84 * mm, 23 * mm, 20 * mm, 52 * mm, 32 * mm],
            styles,
        ),
        Spacer(1, 4 * mm),
        Table([
            [paragraph(f"<b>Referencias:</b> {len(PURCHASE_ITEMS)}", styles["meta"]),
             paragraph(f"<b>Total unidades:</b> {und_total} und", styles["right"])],
            [paragraph("Las cantidades en gramos se controlan por separado.", styles["foot"]),
             paragraph(f"<b>Total peso:</b> {gram_total} g", styles["right"])],
        ], colWidths=[126 * mm, 126 * mm]),
    ]
    doc.build(story, onFirstPage=page_header, onLaterPages=page_header)


def build_warehouse_exit(path):
    styles = base_styles()
    doc = SimpleDocTemplate(
        str(path),
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=15 * mm,
        bottomMargin=14 * mm,
        title="Salida de bodega 3Q QA multireferencia",
        author="WMS QA",
    )
    total = sum(row[2] for row in OUTSOURCING_ITEMS)
    story = [
        paragraph("SALIDA DE BODEGA HACIA 3Q - PRUEBA MULTIREFERENCIA", styles["title"]),
        metadata_table([
            ("Numero de salida", "QA-DOC-20260905-SALIDA-3Q-001", "Fecha", "2026-09-05"),
            ("Destinatario", "3Q - MAQUILA EXTERNA QA", "NIT destinatario", "900333222-1"),
            ("Direccion", "Calle 100 No. 20-30 - Zona industrial", "Ciudad y departamento", "Bogota D.C."),
            ("Entrega", "SOFI - PERFIL ADMINISTRADOR QA", "Recibe", "PENDIENTE DE FIRMA EN 3Q"),
            ("Telefono", "6015550199", "Bultos declarados", "9 paquetes"),
        ], styles),
        Spacer(1, 5 * mm),
        data_table(
            ["SKU", "Material enviado", "Cantidad", "Unidad"],
            [[sku, name, str(quantity), unit] for sku, name, quantity, unit in OUTSOURCING_ITEMS],
            [42 * mm, 142 * mm, 30 * mm, 29 * mm],
            styles,
        ),
        Spacer(1, 4 * mm),
        Table([
            [paragraph(f"<b>Referencias:</b> {len(OUTSOURCING_ITEMS)}", styles["meta"]),
             paragraph(f"<b>Total unidades:</b> {total} und", styles["right"])],
        ], colWidths=[126 * mm, 126 * mm]),
        Spacer(1, 3 * mm),
        paragraph(
            "Los lotes y vencimientos no se declaran en este documento. El WMS debe asignarlos mediante FEFO al preparar la remision operativa. Este PDF solo puede crear un borrador y no modifica inventario.",
            styles["foot"],
        ),
    ]
    doc.build(story, onFirstPage=page_header, onLaterPages=page_header)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    purchase_path = OUTPUT_DIR / "QA-DOC-20260905-OC-MULTI-001.pdf"
    exit_path = OUTPUT_DIR / "QA-DOC-20260905-SALIDA-3Q-001.pdf"
    build_purchase_order(purchase_path)
    build_warehouse_exit(exit_path)
    print(purchase_path)
    print(exit_path)


if __name__ == "__main__":
    main()
