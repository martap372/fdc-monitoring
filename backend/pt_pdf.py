import re
from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


EURO_COLUMNS = {5, 7, 10, 11, 13}


def _plain_value(value):
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _pt_value(value, column):
    if isinstance(value, (int, float)):
        if column in EURO_COLUMNS:
            return f'{value:.2f}€'
        if column == 6:
            return f'{value:.0%}'
    return _plain_value(value)


def _excel_value(value, number_format):
    if not isinstance(value, (int, float)) or not number_format:
        return _plain_value(value)

    decimal_match = re.search(r'\.(0+)', number_format)
    decimals = len(decimal_match.group(1)) if decimal_match else 0
    formatted = f'{value:.{decimals}f}'
    if '%' in number_format:
        return f'{value * 100:.{decimals}f}%'
    if '€' in number_format:
        separator = ' ' if ' €' in number_format else ''
        return f'{formatted}{separator}€'
    return formatted


def _paragraph(value, style):
    return Paragraph(escape(value).replace('\n', '<br/>'), style)


def _table_widths(rows, available_width, minimum=8, maximum=40):
    column_count = max(len(row) for row in rows)
    weights = []
    for column in range(column_count):
        longest = max(
            (len(_plain_value(row[column])) for row in rows if column < len(row)),
            default=minimum,
        )
        weights.append(min(max(longest, minimum), maximum))
    total = sum(weights)
    return [available_width * weight / total for weight in weights]


def _reportlab_table(rows, style, available_width, base_commands, repeat_rows=0):
    formatted_rows = [
        [_paragraph(_plain_value(value), style) for value in row]
        for row in rows
    ]
    table = Table(
        formatted_rows,
        colWidths=_table_widths(rows, available_width),
        repeatRows=repeat_rows,
        hAlign='LEFT',
    )
    table.setStyle(TableStyle(base_commands))
    return table


def _vencimento_table(values, styles, merge_data, month_index, cell_style, available_width):
    source_rows = [0, 1, month_index + 2]
    rows = [values[index] for index in source_rows]
    style_rows = [styles[index] for index in source_rows]
    formatted_rows = []
    for row_index, row in enumerate(rows):
        formatted_rows.append([
            _paragraph(
                _excel_value(value, style_rows[row_index][column].get('numberFormat')),
                cell_style,
            )
            for column, value in enumerate(row)
        ])

    table = Table(
        formatted_rows,
        colWidths=_table_widths(rows, available_width),
        hAlign='LEFT',
    )
    commands = [
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d9dee5')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]
    alignment_map = {'left': 'LEFT', 'center': 'CENTER', 'right': 'RIGHT'}
    border_commands = {
        'top': 'LINEABOVE',
        'bottom': 'LINEBELOW',
        'left': 'LINEBEFORE',
        'right': 'LINEAFTER',
    }
    for row_index, row_styles in enumerate(style_rows):
        for column, cell in enumerate(row_styles):
            background = cell.get('backgroundColor')
            if background:
                commands.append((
                    'BACKGROUND', (column, row_index), (column, row_index),
                    colors.HexColor(background),
                ))
            text_color = cell.get('color')
            if text_color:
                commands.append((
                    'TEXTCOLOR', (column, row_index), (column, row_index),
                    colors.HexColor(text_color),
                ))
            if cell.get('fontWeight') == 'bold':
                commands.append(('FONTNAME', (column, row_index), (column, row_index), 'Helvetica-Bold'))
            alignment = alignment_map.get(cell.get('horizontalAlignment'))
            if alignment:
                commands.append(('ALIGN', (column, row_index), (column, row_index), alignment))
            for side, command in border_commands.items():
                border = cell.get('borders', {}).get(side)
                if border and border.get('s'):
                    border_color = border.get('cl', {}).get('rgb', '#000000')
                    commands.append((
                        command, (column, row_index), (column, row_index),
                        0.75, colors.HexColor(border_color),
                    ))

    for merge in merge_data:
        if merge['endRow'] <= 1:
            commands.append((
                'SPAN',
                (merge['startColumn'], merge['startRow']),
                (merge['endColumn'], merge['endRow']),
            ))
    table.setStyle(TableStyle(commands))
    return table


def build_pt_export_pdf(pt_rows, vencimento_sheet, month_name, year, person, month_index):
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A3),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f'{person} - {month_name} {year}',
    )
    stylesheet = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'ExportTitle', parent=stylesheet['Title'], fontName='Helvetica-Bold',
        fontSize=16, leading=19, alignment=0, textColor=colors.HexColor('#12344d'),
        spaceAfter=3,
    )
    subtitle_style = ParagraphStyle(
        'ExportSubtitle', parent=stylesheet['Normal'], fontName='Helvetica',
        fontSize=9, leading=11, textColor=colors.HexColor('#495057'), spaceAfter=7,
    )
    heading_style = ParagraphStyle(
        'ExportHeading', parent=stylesheet['Heading2'], fontName='Helvetica-Bold',
        fontSize=11, leading=13, textColor=colors.HexColor('#12344d'),
        spaceBefore=8, spaceAfter=4,
    )
    table_cell_style = ParagraphStyle(
        'ExportCell', parent=stylesheet['Normal'], fontName='Helvetica',
        fontSize=6.5, leading=8,
    )
    summary_cell_style = ParagraphStyle(
        'SummaryCell', parent=stylesheet['Normal'], fontName='Helvetica',
        fontSize=8, leading=10,
    )

    main_rows = [row[:14] for row in pt_rows]
    last_main_row = max(
        (index for index, row in enumerate(main_rows) if any(value not in (None, '') for value in row)),
        default=0,
    )
    main_rows = main_rows[:last_main_row + 1]
    formatted_main_rows = [
        [_pt_value(value, column) for column, value in enumerate(row)]
        for row in main_rows
    ]

    summary_rows = []
    for row in pt_rows[1:]:
        summary = row[15:18]
        if not any(value not in (None, '') for value in summary):
            continue
        value = _plain_value(summary[1] if len(summary) > 1 else None)
        if len(summary) > 2 and isinstance(summary[2], (int, float)):
            value = f'{value} ({summary[2]:.2f}€)'
        summary_rows.append([_plain_value(summary[0]), value])

    available_width = document.width
    main_table = _reportlab_table(
        formatted_main_rows,
        table_cell_style,
        available_width,
        [
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d9dee5')),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 6.5),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 3),
            ('RIGHTPADDING', (0, 0), (-1, -1), 3),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ],
        repeat_rows=1,
    )

    story = [
        _paragraph(f'Treinos PT - {person}', title_style),
        _paragraph(f'{month_name} {year}', subtitle_style),
        main_table,
    ]
    if summary_rows:
        summary_table = _reportlab_table(
            summary_rows,
            summary_cell_style,
            min(available_width, 380),
            [
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d9dee5')),
                ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f3f4f6')),
                ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
                ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 5),
                ('RIGHTPADDING', (0, 0), (-1, -1), 5),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ],
        )
        for row_index, row in enumerate(summary_rows):
            if row[0] == 'A receber':
                summary_table.setStyle(TableStyle([
                    ('FONTNAME', (0, row_index), (-1, row_index), 'Helvetica-Bold'),
                ]))
        story.extend([Spacer(1, 5), _paragraph('Resumo', heading_style), summary_table])

    story.extend([
        Spacer(1, 8),
        _paragraph(f'Vencimento - {person}', heading_style),
        _paragraph(f'{month_name} {year}', subtitle_style),
    ])
    vencimento_values = vencimento_sheet['values']
    if len(vencimento_values) <= month_index + 2:
        raise ValueError('A folha de vencimentos não contém o mês selecionado.')
    story.append(_vencimento_table(
        vencimento_values,
        vencimento_sheet['styles'],
        vencimento_sheet.get('mergeData', []),
        month_index,
        table_cell_style,
        available_width,
    ))

    document.build(story)
    buffer.seek(0)
    return buffer