import { Fragment } from 'react';

const borderStyle = (border) => {
	if (!border?.s) return undefined;
	return `1px solid ${border.cl?.rgb || '#000000'}`;
};

const cellStyle = (style = {}) => ({
	backgroundColor: style.backgroundColor || undefined,
	color: style.color || undefined,
	fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
	fontStyle: style.fontStyle || undefined,
	fontWeight: style.fontWeight || undefined,
	textAlign: style.horizontalAlignment || undefined,
	verticalAlign: style.verticalAlignment || undefined,
	whiteSpace: style.wrapText ? 'normal' : 'nowrap',
	borderTop: borderStyle(style.borders?.top),
	borderRight: borderStyle(style.borders?.right),
	borderBottom: borderStyle(style.borders?.bottom),
	borderLeft: borderStyle(style.borders?.left),
});

const formatNumber = (value, numberFormat) => {
	if (typeof value !== 'number' || !numberFormat) return value ?? '';
	const decimalMatch = numberFormat.match(/\.(0+)/);
	const decimals = decimalMatch ? decimalMatch[1].length : 0;
	const formatted = value.toFixed(decimals);
	if (numberFormat.includes('%')) return `${(value * 100).toFixed(decimals)}%`;
	if (numberFormat.includes('€')) return `${formatted}${numberFormat.includes(' €') ? ' ' : ''}€`;
	return formatted;
};

const displayValue = (value, rowIndex, numberFormat) => {
	const formattedValue = formatNumber(value, numberFormat);
	if (rowIndex !== 0 || typeof formattedValue !== 'string') return formattedValue;
	const words = formattedValue.trim().split(/\s+/);
	if (words.length !== 2) return formattedValue;
	return <>{words[0]}<br />{words[1]}</>;
};

const getMerge = (mergeData, rowIndex, columnIndex) => mergeData.find((merge) => (
	rowIndex >= merge.startRow
	&& rowIndex <= merge.endRow
	&& columnIndex >= merge.startColumn
	&& columnIndex <= merge.endColumn
));

const StaticTable = ({
	rows,
	styles = [],
	numberFormats = {},
	mergeData = [],
	label,
	titleColumn = false,
	editableColumns = [],
	editableRows = null,
	inputValues = {},
	onCellInput,
	onCellChange,
	boldRowLabels = [],
	disabled = false,
	sectionDividerColumns = [],
	euroInputColumns = [13],
	rowActions,
	rowDetails,
	rowActionColumnCount = 1,
}) => {
	const isCoveredCell = (rowIndex, columnIndex) => {
		const merge = getMerge(mergeData, rowIndex, columnIndex);
		return merge && (merge.startRow !== rowIndex || merge.startColumn !== columnIndex);
	};
	const sectionCellStyle = (rowIndex, columnIndex, merge) => {
		const base = cellStyle(styles[rowIndex]?.[columnIndex]);
		const endsSection = sectionDividerColumns.includes(columnIndex)
			|| sectionDividerColumns.includes(merge?.endColumn);
		if (!endsSection) return base;
		return { ...base, borderRight: '3px solid #12344d' };
	};

	return (
		<div className="static-table-wrap">
			<table className={`static-table${titleColumn ? ' static-table-title-column' : ''}`} aria-label={label}>
				<tbody>
					{rows.map((row, rowIndex) => {
						const details = rowIndex > 0 ? rowDetails?.(row, rowIndex) : null;
						return (
							<Fragment key={rowIndex}>
								<tr style={boldRowLabels.includes(row[0]) ? { fontWeight: 'bold' } : undefined}>
									{row.map((value, columnIndex) => {
										if (isCoveredCell(rowIndex, columnIndex)) return null;
										const merge = getMerge(mergeData, rowIndex, columnIndex);
										const inputValue = inputValues[`${rowIndex}:${columnIndex}`];
										const isEditable = rowIndex > 0
											&& editableColumns.includes(columnIndex)
											&& (!editableRows || editableRows.includes(rowIndex));
										const input = (
											<input
												key={`${label}-${rowIndex}-${columnIndex}`}
												className={`static-table-input${euroInputColumns.includes(columnIndex) ? ' no-number-spinner' : ''}`}
												type="number"
												min="0"
												step="1"
												{...(inputValue === undefined ? { defaultValue: value ?? '' } : { value: inputValue })}
												disabled={disabled}
												onChange={(event) => onCellInput?.(event.target.value, rowIndex, columnIndex)}
												onBlur={(event) => onCellChange?.(event.target.value, rowIndex, columnIndex)}
												onKeyDown={(event) => {
													if (event.key === 'Enter') event.currentTarget.blur();
												}}
											/>
										);
										const content = isEditable ? (
											euroInputColumns.includes(columnIndex) ? (
												<span className="static-table-euro-input">{input}<span aria-hidden="true">€</span></span>
											) : input
										) : displayValue(
											value,
											titleColumn && columnIndex === 0 ? 1 : rowIndex,
											styles[rowIndex]?.[columnIndex]?.numberFormat
												|| numberFormats[`${rowIndex}:${columnIndex}`]
												|| numberFormats[columnIndex],
										);
										return titleColumn && columnIndex === 0 ? (
											<th
												key={columnIndex}
												scope="row"
												rowSpan={merge ? merge.endRow - merge.startRow + 1 : undefined}
												colSpan={merge ? merge.endColumn - merge.startColumn + 1 : undefined}
												style={sectionCellStyle(rowIndex, columnIndex, merge)}
											>
												{content}
											</th>
										) : (
											<td
												key={columnIndex}
												rowSpan={merge ? merge.endRow - merge.startRow + 1 : undefined}
												colSpan={merge ? merge.endColumn - merge.startColumn + 1 : undefined}
												style={sectionCellStyle(rowIndex, columnIndex, merge)}
											>
												{content}
											</td>
										);
									})}
									{rowActions && rowIndex > 0 ? rowActions(row, rowIndex) : null}
								</tr>
								{details != null && (
									<tr className="static-table-detail-row">
										<td colSpan={row.length + (rowActions ? rowActionColumnCount : 0)}>{details}</td>
									</tr>
								)}
							</Fragment>
						);
					})}
				</tbody>
			</table>
		</div>
	);
};

export default StaticTable;