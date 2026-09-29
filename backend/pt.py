import json
import os
import re
import threading

import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils.cell import column_index_from_string, coordinate_from_string, range_boundaries

BACKEND_DIR = os.path.join(os.path.dirname(__file__), 'data')
CLIENT_SINCE_PATH = os.path.join(BACKEND_DIR, 'client_since.json')
WORKBOOK_LOCK = threading.Lock()

meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

data = {"André Mota": {"Nº Sócio": [], "Nome do Cliente": [], "Contrato": [], "Horas": [], "Valor c/iva": [], "%": [], "Comissão PT": "", "Total Treinos": [], "Treinos Dados": "", "Valor/Treino": "", "A receber": "", "Treinos em Falta": "", "Valor em Falta": ""},
    "Simão Sá": {"Nº Sócio": [], "Nome do Cliente": [], "Contrato": [], "Horas": [], "Valor c/iva": [], "%": [], "Comissão PT": "", "Total Treinos": [], "Treinos Dados": "", "Valor/Treino": "", "A receber": "", "Treinos em Falta": "", "Valor em Falta": ""},
    "Pedro Freitas": {"Nº Sócio": [], "Nome do Cliente": [], "Contrato": [], "Horas": [], "Valor c/iva": [], "%": [], "Comissão PT": "", "Total Treinos": [], "Treinos Dados": "", "Valor/Treino": "", "A receber": "", "Treinos em Falta": "", "Valor em Falta": ""},
    "Emanuel Ferreira": {"Nº Sócio": [], "Nome do Cliente": [], "Contrato": [], "Horas": [], "Valor c/iva": [], "%": [], "Comissão PT": "", "Total Treinos": [], "Treinos Dados": "", "Valor/Treino": "", "A receber": "", "Treinos em Falta": "", "Valor em Falta": ""},
    "Rúben Ramos": {"Nº Sócio": [], "Nome do Cliente": [], "Contrato": [], "Horas": [], "Valor c/iva": [], "%": [], "Comissão PT": "", "Total Treinos": [], "Treinos Dados": "", "Valor/Treino": "", "A receber": "", "Treinos em Falta": "", "Valor em Falta": ""},
    "Daniel Araújo": {"Nº Sócio": [], "Nome do Cliente": [], "Contrato": [], "Horas": [], "Valor c/iva": [], "%": [], "Comissão PT": "", "Total Treinos": [], "Treinos Dados": "", "Valor/Treino": "", "A receber": "", "Treinos em Falta": "", "Valor em Falta": ""}}

resumo = {"André Mota": {"Total Clientes": [], "Total Horas": [], "Total Faturação": [], "Total Treinos Pagos": [], "Total Treinos Dados": [], "Total Treinos em Falta": [], "Total Treinos Recuperados": [], "A receber": []},
        "Simão Sá": {"Total Clientes": [], "Total Horas": [], "Total Faturação": [], "Total Treinos Pagos": [], "Total Treinos Dados": [], "Total Treinos em Falta": [], "Total Treinos Recuperados": [], "A receber": []},
        "Pedro Freitas": {"Total Clientes": [], "Total Horas": [], "Total Faturação": [], "Total Treinos Pagos": [], "Total Treinos Dados": [], "Total Treinos em Falta": [], "Total Treinos Recuperados": [], "A receber": []},
        "Emanuel Ferreira": {"Total Clientes": [], "Total Horas": [], "Total Faturação": [], "Total Treinos Pagos": [], "Total Treinos Dados": [], "Total Treinos em Falta": [], "Total Treinos Recuperados": [], "A receber": []},
        "Rúben Ramos": {"Total Clientes": [], "Total Horas": [], "Total Faturação": [], "Total Treinos Pagos": [], "Total Treinos Dados": [], "Total Treinos em Falta": [], "Total Treinos Recuperados": [], "A receber": []},
        "Daniel Araújo": {"Total Clientes": [], "Total Horas": [], "Total Faturação": [], "Total Treinos Pagos": [], "Total Treinos Dados": [], "Total Treinos em Falta": [], "Total Treinos Recuperados": [], "A receber": []}}


def pt_files():
    return sorted(
        filename for filename in os.listdir(BACKEND_DIR)
        if filename.startswith('PT_') and filename.endswith('.xlsx')
    )


def _member_key(value):
    if value is None or value == '':
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _existing_training_values(filename):
    workbook_path = os.path.join(BACKEND_DIR, filename)
    if not os.path.exists(workbook_path):
        return {}

    workbook = load_workbook(workbook_path, data_only=False, read_only=True)
    training_values = {}
    for worksheet in workbook.worksheets:
        headers = next(worksheet.iter_rows(min_row=1, max_row=1, values_only=True), ())
        try:
            member_column = headers.index('Nº Sócio')
            training_column = headers.index('Treinos Dados')
        except ValueError:
            continue

        training_values[worksheet.title] = {
            _member_key(row[member_column]): row[training_column]
            for row in worksheet.iter_rows(min_row=2, values_only=True)
            if len(row) > max(member_column, training_column)
            and _member_key(row[member_column]) is not None
        }
    workbook.close()
    return training_values


def _number(row, column):
    value = row[column] if column < len(row) else None
    return value if isinstance(value, (int, float)) else 0


def _commission_rate(total_faturacao):
    if total_faturacao < 1000:
        return 0.45
    if total_faturacao < 2000:
        return 0.5
    if total_faturacao < 3000:
        return 0.55
    return 0.6


def _commission_rate_for_client(rate, member_number, month, year, client_since):
    member = _member_key(member_number)
    if member is None:
        return rate

    start = client_since.get(member)
    if start is None:
        client_since[member] = f'{month:02d}-{year}'
        return rate

    start_month, start_year = (int(part) for part in start.split('-'))
    months_as_client = (year - start_year) * 12 + month - start_month
    if months_as_client > 24:
        return rate + 0.10
    if months_as_client > 12:
        return rate + 0.05
    return rate


def _save_client_since(client_since):
    temporary_path = f'{CLIENT_SINCE_PATH}.tmp'
    with open(temporary_path, 'w', encoding='utf-8') as registry_file:
        json.dump(client_since, registry_file, indent=4, ensure_ascii=False)
        registry_file.write('\n')
    os.replace(temporary_path, CLIENT_SINCE_PATH)


def _round_to_nearest_005(value):
    return round(value * 20) / 20


def _pt_calculated_values(row):
    calculated = list(row)
    calculated[6] = round(_number(row, 4) * _number(row, 5) / 1.23, 2)
    calculated[9] = round(calculated[6] / _number(row, 7), 2) if _number(row, 7) else 0
    calculated[10] = _number(row, 8) * calculated[9]
    calculated[11] = _number(row, 7) - _number(row, 8)
    calculated[12] = calculated[9] * calculated[11]
    return calculated


def _pt_summary_values(rows):
    data_rows = rows[1:]
    for row in rows:
        if len(row) > 15 and isinstance(row[14], str) and row[14]:
            row[15] = {
                'Total Clientes': sum(1 for data_row in data_rows if data_row[0]),
                'Total Horas': sum(_number(data_row, 3) for data_row in data_rows),
                'Total Faturação': sum(_number(data_row, 4) for data_row in data_rows),
                'Total Treinos Pagos': sum(_number(data_row, 7) for data_row in data_rows),
                'Total Treinos Dados': sum(_number(data_row, 8) for data_row in data_rows),
                'Total Treinos em Falta': sum(_number(data_row, 11) for data_row in data_rows),
                'Total Treinos Recuperados': sum(
                    _number(data_row, 8)
                    for data_row in data_rows
                    if len(data_row) > 13 and data_row[13] == 'added'
                ),
                'A receber': sum(_number(data_row, 10) for data_row in data_rows),
            }.get(row[14])
            if len(row) > 16 and row[14] == 'Total Treinos Pagos':
                row[16] = sum(_number(data_row, 6) for data_row in data_rows)
            if len(row) > 16 and row[14] == 'Total Treinos Dados':
                row[16] = sum(_number(data_row, 10) for data_row in data_rows)
            if len(row) > 16 and row[14] == 'Total Treinos em Falta':
                row[16] = sum(_number(data_row, 12) for data_row in data_rows)


def workbook_data(filename, include_styles=False, data_only=False):
    workbook = load_workbook(
        os.path.join(BACKEND_DIR, filename), data_only=data_only, read_only=not include_styles
    )

    def color_value(color):
        if not color or color.type != 'rgb' or not color.rgb:
            return None
        return f'#{color.rgb[-6:]}'

    def border_value(side):
        if not side or not side.style:
            return None
        return {
            's': 1,
            'cl': {'rgb': color_value(side.color) or '#000000'},
        }

    result = {}
    for worksheet in workbook.worksheets:
        values = []
        styles = []
        for row_index, row in enumerate(worksheet.iter_rows()):
            value_row = []
            style_row = []
            for cell in row:
                value = cell.value
                value_row.append(value)
                border = cell.border
                style_row.append({
                    'backgroundColor': color_value(cell.fill.fgColor)
                    if cell.fill and cell.fill.fill_type else None,
                    'color': color_value(cell.font.color) if cell.font else None,
                    'fontWeight': 'bold' if cell.font and cell.font.bold else None,
                    'fontStyle': 'italic' if cell.font and cell.font.italic else None,
                    'fontSize': cell.font.sz if cell.font else None,
                    'numberFormat': cell.number_format or None,
                    'horizontalAlignment': cell.alignment.horizontal if cell.alignment else None,
                    'verticalAlignment': cell.alignment.vertical if cell.alignment else None,
                    'wrapText': cell.alignment.wrap_text if cell.alignment else None,
                    'borders': {
                        'top': border_value(border.top) if border else None,
                        'bottom': border_value(border.bottom) if border else None,
                        'left': border_value(border.left) if border else None,
                        'right': border_value(border.right) if border else None,
                    },
                })
            values.append(value_row)
            styles.append(style_row)
        if values and 'Meio Pagamento' in values[0]:
            for row in values:
                row.pop(4)
            for row in styles:
                row.pop(4)
        if not include_styles:
            data_rows = [row for row in values[1:] if row and row[0] not in (None, '')]
            total_faturacao = sum(_number(row, 4) for row in data_rows)
            commission_rate = _commission_rate(total_faturacao)
            for row_index in range(1, len(values)):
                if values[row_index] and values[row_index][0] not in (None, ''):
                    values[row_index][6] = commission_rate
                    values[row_index] = _pt_calculated_values(values[row_index])
            _pt_summary_values(values)
        if include_styles:
            merge_data = []
            for merged_range in worksheet.merged_cells.ranges:
                min_column, min_row, max_column, max_row = range_boundaries(str(merged_range))
                merge_data.append({
                    'startRow': min_row - 1,
                    'startColumn': min_column - 1,
                    'endRow': max_row - 1,
                    'endColumn': max_column - 1,
                })
            freeze = None
            if worksheet.freeze_panes:
                freeze_column, freeze_row = coordinate_from_string(worksheet.freeze_panes)
                freeze = {
                    'startRow': freeze_row - 1,
                    'startColumn': column_index_from_string(freeze_column) - 1,
                    'xSplit': column_index_from_string(freeze_column) - 1,
                    'ySplit': freeze_row - 1,
                }
            result[worksheet.title] = {
                'values': values,
                'styles': styles,
                'mergeData': merge_data,
                'freeze': freeze,
            }
        else:
            result[worksheet.title] = values
    return result


def _import_period(value):
    text = str(value)
    year_match = re.search(r'(20\d{2})', text)
    if not year_match:
        raise ValueError('Não foi possível identificar o ano no ficheiro enviado.')

    date_match = re.search(r'\d{1,2}[/-](1[0-2]|0?[1-9])[/-]20\d{2}', text)
    month_match = date_match or re.search(r'(?<!\d)(1[0-2]|0?[1-9])(?!\d)', text)
    if month_match:
        month = int(month_match.group(1))
    else:
        normalized = text.casefold()
        month = next(
            (index + 1 for index, name in enumerate(meses) if name.casefold() in normalized),
            None,
        )
    if not month:
        raise ValueError('Não foi possível identificar o mês no ficheiro enviado.')
    return month - 1, year_match.group(1)


def _validate_import_source(df):
    if len(df.index) < 5 or len(df.columns) < 13:
        raise ValueError('O ficheiro PT não tem o formato esperado.')
    try:
        _import_period(df.iloc[3, 2])
    except (IndexError, TypeError, ValueError):
        raise ValueError('O ficheiro PT não contém um período válido.')

    valid_records = 0
    for row in range(1, len(df.index)):
        if not str(df.iloc[row, 1]).startswith('Total'):
            continue
        if row == 0 or df.iloc[row - 1, 12] not in data:
            continue
        try:
            float(str(df.iloc[row, 1]).replace('Total: ', ''))
            float(str(df.iloc[row - 1, 8]).replace(' min', ''))
            float(df.iloc[row - 1, 9])
        except (TypeError, ValueError):
            continue
        if pd.isna(df.iloc[row - 1, 3]) or pd.isna(df.iloc[row - 1, 4]):
            continue
        valid_records += 1

    if not valid_records:
        raise ValueError('O ficheiro PT não contém registos válidos.')


# df[column][row]

def import_(filename):
    if not os.path.isabs(filename):
        filename = os.path.join(BACKEND_DIR, filename)

    for person, values in data.items():
        for field, value in values.items():
            if isinstance(value, list):
                values[field] = []
        values["%"] = []
        values["Treinos Dados"] = []

    df = pd.read_excel(filename, header=None)
    _validate_import_source(df)

    global mes
    mes, ano = _import_period(df.iloc[3, 2])
    with open(CLIENT_SINCE_PATH, encoding='utf-8') as registry_file:
        client_since = json.load(registry_file)

    for row in range(0, len(df.index)):
        if str(df[1][row]).startswith("Total"):
            total = float(df[1][row].replace("Total: ", ""))
            pt = df[12][row-1]
            if pt not in data.keys():
                continue
            # Nº Sócio
            data[pt]["Nº Sócio"].append(df[3][row-1])
            # Nome do Cliente
            data[pt]["Nome do Cliente"].append(df[4][row-1])
            # Contrato
            data[pt]["Contrato"].append(df[7][row-1])
            # Horas
            data[pt]["Horas"].append((float(df[8][row-1].replace(" min", ""))*total)/60)
            # Valor c/iva
            valor_c_iva = float(df[9][row-1]) * total
            data[pt]["Valor c/iva"].append(_round_to_nearest_005(valor_c_iva))
            # Total Treinos
            data[pt]["Total Treinos"].append(total)

    for pt in data.keys():
        length = int(len(data[pt]["Nº Sócio"]))
        total_faturacao = sum(data[pt]["Valor c/iva"])
        base_rate = _commission_rate(total_faturacao)
        data[pt]["%"] = [
            _commission_rate_for_client(
                base_rate, member_number, mes + 1, int(ano), client_since
            )
            for member_number in data[pt]["Nº Sócio"]
        ]

    output_filename = os.path.join(
        BACKEND_DIR, f'PT_{meses[mes]}{ano}.xlsx'
    )
    existing_training_values = _existing_training_values(os.path.basename(output_filename))
    for person, values in data.items():
        previous_values = existing_training_values.get(person, {})
        values["Treinos Dados"] = [
            previous_values.get(_member_key(member_number))
            for member_number in values["Nº Sócio"]
        ]

    writer = pd.ExcelWriter(output_filename, engine='xlsxwriter')
    workbook=writer.book

    for sheet in data.keys():
        df1 = pd.DataFrame.from_dict(data[sheet])
        df2 = pd.DataFrame.from_dict(resumo[sheet])
        
        length = len(df1)+1
        worksheet=workbook.add_worksheet(sheet)
        writer.sheets[sheet] = worksheet

        df1.to_excel(writer,sheet_name=sheet, index=False, startrow=0 , startcol=0)
        df2.T.to_excel(writer,sheet_name=sheet, index=True, startrow=0, startcol=14)

        for row in range(1, len(df1) + 1): 
            # Comissão PT
            worksheet.write_formula(row, 6, f"=ROUND(E{row + 1}*F{row + 1}/1.23,2)")
            # Valor/Treino
            worksheet.write_formula(row, 9, f"=ROUND(G{row + 1}/H{row + 1},2)")
            # A receber
            worksheet.write_formula(row, 10, f"=I{row + 1}*J{row + 1}")
            # Treinos em Falta
            worksheet.write_formula(row, 11, f"=H{row + 1}-I{row + 1}")
            # Valor em Falta
            worksheet.write_formula(row, 12, f"=J{row + 1}*L{row + 1}")

        percent = workbook.add_format({"num_format": "0%"})
        euro = workbook.add_format({"num_format": "0.00€"})
        header = workbook.add_format({'bold': True, 'align': 'center'})
        worksheet.set_column("E:E", None, euro)
        worksheet.set_column("F:F", None, percent)
        worksheet.set_column("G:G", None, euro)
        worksheet.set_column("J:J", None, euro)
        worksheet.set_column("K:K", None, euro)
        worksheet.set_column("M:M", None, euro)
        worksheet.set_row(0, None, header)
        worksheet.set_column("O:O", None, header)

        # Total Clientes
        worksheet.write_formula("P2", f"=COUNT(A2:A{length})")
        # Total Horas
        worksheet.write_formula("P3", f"=SUM(D2:D{length})")
        # Total Faturação
        worksheet.write("P4", f"=SUM(E2:E{length})", euro)
        # Total Treinos Pagos
        worksheet.write_formula("P5", f"=SUM(H2:H{length})")
        worksheet.write("Q5", f"=SUM(G2:G{length})", euro)
        # Total Treinos Dados
        worksheet.write_formula("P6", f"=SUM(I2:I{length})")
        worksheet.write("Q6", f"=SUM(K2:K{length})", euro)
        # Total Treinos em Falta
        worksheet.write_formula("P7", f"=SUM(L2:L{length})")
        worksheet.write("Q7", f"=SUM(M2:M{length})", euro)
        # A receber
        worksheet.write("P9", f"=SUM(K2:K{length})", euro)

    writer.close()
    _save_client_since(client_since)
    from mapa_sala import schedule_vencimento_update
    schedule_vencimento_update(year=int(ano))
    return os.path.basename(output_filename)

