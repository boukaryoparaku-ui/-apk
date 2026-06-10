import { useMemo } from "react";
import { buildInventoryMatrix, compareSizes, matrixKey, migrateQuickSkuAxis, parseList } from "./inventoryLogic";
import type { QuickSkuForm, Sku } from "./types";

export function QuickSkuMatrix({
  value,
  onChange,
  showQuantities = true
}: {
  value: QuickSkuForm;
  onChange: (next: QuickSkuForm) => void;
  showQuantities?: boolean;
}) {
  const colors = parseList(value.colorsText);
  const sizes = parseList(value.sizesText).sort(compareSizes);
  const set = (key: keyof Omit<QuickSkuForm, "quantities">, fieldValue: string) => onChange({ ...value, [key]: fieldValue });
  const migrateAxis = (axis: "color" | "size", nextText: string) => onChange(migrateQuickSkuAxis(value, axis, nextText));
  const setQuantity = (color: string, size: string, quantity: string) =>
    onChange({
      ...value,
      quantities: {
        ...value.quantities,
        [matrixKey(color, size)]: quantity
      }
    });

  return (
    <div className="quick-entry">
      <div className="grid two">
        <label>
          款号
          <input value={value.styleNo} onChange={(event) => set("styleNo", event.target.value)} required />
        </label>
        <label>
          商品名称
          <input value={value.productName} onChange={(event) => set("productName", event.target.value)} required />
        </label>
        <label>
          供应商
          <input value={value.supplier} onChange={(event) => set("supplier", event.target.value)} required />
        </label>
        <label>
          品类
          <input value={value.category} onChange={(event) => set("category", event.target.value)} />
        </label>
        <label>
          品牌
          <input value={value.brand} onChange={(event) => set("brand", event.target.value)} />
        </label>
        <label>
          零售价
          <input type="number" min="0" step="0.01" value={value.retailPrice} onChange={(event) => set("retailPrice", event.target.value)} />
        </label>
        <label>
          尺码
          <input value={value.sizesText} onChange={(event) => migrateAxis("size", event.target.value)} placeholder="如：S, M, L, XL" />
        </label>
      </div>

      <label>
        颜色
        <textarea value={value.colorsText} onChange={(event) => migrateAxis("color", event.target.value)} placeholder="每行一个颜色，或用逗号分隔，如：黑色、白色、米色" />
      </label>

      <div className="table-wrap matrix-wrap quick-matrix-wrap">
        <table className="matrix-table quick-matrix">
          <thead>
            <tr className="matrix-band">
              <th>颜色</th>
              {sizes.length ? sizes.map((size) => <th key={size}>{size}</th>) : <th>尺码</th>}
              {showQuantities && <th>行合计</th>}
            </tr>
          </thead>
          <tbody>
            {colors.length && sizes.length ? (
              colors.map((color) => {
                const rowTotal = sizes.reduce((sum, size) => sum + Number(value.quantities[matrixKey(color, size)] || 0), 0);
                return (
                  <tr key={color}>
                    <td className="code-cell">{color}</td>
                    {sizes.map((size) => (
                      <td key={size}>
                        {showQuantities ? (
                          <input
                            className="matrix-input"
                            type="number"
                            min="0"
                            value={value.quantities[matrixKey(color, size)] || ""}
                            onChange={(event) => setQuantity(color, size, event.target.value)}
                          />
                        ) : (
                          <span className="sku-dot">SKU</span>
                        )}
                      </td>
                    ))}
                    {showQuantities && <td className="number-cell">{rowTotal || ""}</td>}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={Math.max(sizes.length, 1) + (showQuantities ? 2 : 1)} className="empty">
                  请先填写颜色和尺码
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function InventoryMatrix({ skus }: { skus: Sku[] }) {
  const matrix = useMemo(() => buildInventoryMatrix(skus), [skus]);
  const infoColumnCount = 8;
  const summary = useMemo(() => {
    const sizeTotals = matrix.sizes.reduce<Record<string, number>>((totals, size) => {
      totals[size] = matrix.rows.reduce((sum, row) => sum + (row.sizes[size] || 0), 0);
      return totals;
    }, {});
    const stockTotal = matrix.rows.reduce((sum, row) => sum + row.total, 0);
    const soldTotal = matrix.rows.reduce((sum, row) => sum + row.soldQuantity, 0);
    return { sizeTotals, stockTotal, soldTotal };
  }, [matrix]);

  return (
    <div className="table-wrap matrix-wrap">
      <table className="matrix-table">
        <thead>
          <tr className="matrix-band">
            <th colSpan={infoColumnCount}>商品尺码横排信息</th>
            <th colSpan={Math.max(matrix.sizes.length, 1)}>尺码库存</th>
            <th>小计</th>
          </tr>
          <tr>
            <th>序号</th>
            <th>商品款号</th>
            <th>商品名称</th>
            <th>单位</th>
            <th>颜色</th>
            <th>合计库存</th>
            <th>已销售数量</th>
            <th>单价</th>
            {matrix.sizes.length ? matrix.sizes.map((size) => <th key={size}>{size}</th>) : <th>尺码</th>}
            <th>数量</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row, index) => (
            <tr key={row.key} className={row.hasNegative ? "negative-row" : ""}>
              <td className="serial">{index + 1}</td>
              <td className="code-cell">{row.styleNo}</td>
              <td>{row.productName}</td>
              <td>{row.unit}</td>
              <td>{row.color}</td>
              <td className={row.total < 0 ? "danger-text number-cell" : "number-cell"}>{row.total}</td>
              <td>{row.soldQuantity}</td>
              <td>{row.retailPrice}</td>
              {matrix.sizes.length ? (
                matrix.sizes.map((size) => {
                  const quantity = row.sizes[size] || 0;
                  return (
                    <td key={size} className={quantity < 0 ? "danger-text number-cell" : "number-cell"}>
                      {quantity === 0 ? "" : quantity}
                    </td>
                  );
                })
              ) : (
                <td className="empty">暂无尺码</td>
              )}
              <td className={row.total < 0 ? "danger-text number-cell" : "number-cell"}>{row.total}</td>
            </tr>
          ))}
          {!!matrix.rows.length && (
            <tr className="summary-row">
              <td colSpan={5}>合计</td>
              <td className={summary.stockTotal < 0 ? "danger-text number-cell" : "number-cell"}>{summary.stockTotal}</td>
              <td className="number-cell">{summary.soldTotal}</td>
              <td>-</td>
              {matrix.sizes.length ? (
                matrix.sizes.map((size) => {
                  const quantity = summary.sizeTotals[size] || 0;
                  return (
                    <td key={size} className={quantity < 0 ? "danger-text number-cell" : "number-cell"}>
                      {quantity === 0 ? "" : quantity}
                    </td>
                  );
                })
              ) : (
                <td className="empty">暂无尺码</td>
              )}
              <td className={summary.stockTotal < 0 ? "danger-text number-cell" : "number-cell"}>{summary.stockTotal}</td>
            </tr>
          )}
          {!matrix.rows.length && (
            <tr>
              <td colSpan={infoColumnCount + Math.max(matrix.sizes.length, 1) + 1} className="empty">
                暂无库存数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SkuQuantityMatrix({
  skus,
  quantities,
  onChange,
  title,
  emptyText
}: {
  skus: Sku[];
  quantities: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  title: string;
  emptyText: string;
}) {
  const colors = useMemo(
    () => Array.from(new Set(skus.map((sku) => sku.color))).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true })),
    [skus]
  );
  const sizes = useMemo(() => Array.from(new Set(skus.map((sku) => sku.size))).sort(compareSizes), [skus]);
  const skuMap = useMemo(() => {
    const map = new Map<string, Sku>();
    skus.forEach((sku) => map.set(matrixKey(sku.color, sku.size), sku));
    return map;
  }, [skus]);
  const total = skus.reduce((sum, sku) => sum + Number(quantities[String(sku.id)] || 0), 0);

  function setQuantity(skuId: number, quantity: string) {
    onChange({ ...quantities, [String(skuId)]: quantity });
  }

  return (
    <div className="table-wrap matrix-wrap outbound-matrix-wrap">
      <table className="matrix-table outbound-matrix">
        <thead>
          <tr className="matrix-band">
            <th colSpan={2}>{title}</th>
            <th colSpan={Math.max(sizes.length, 1)}>尺码</th>
            <th>行合计</th>
          </tr>
          <tr>
            <th>颜色</th>
            <th>当前库存</th>
            {sizes.length ? sizes.map((size) => <th key={size}>{size}</th>) : <th>尺码</th>}
            <th>数量</th>
          </tr>
        </thead>
        <tbody>
          {colors.length && sizes.length ? (
            colors.map((color) => {
              const colorSkus = skus.filter((sku) => sku.color === color);
              const rowStock = colorSkus.reduce((sum, sku) => sum + sku.quantity, 0);
              const rowTotal = colorSkus.reduce((sum, sku) => sum + Number(quantities[String(sku.id)] || 0), 0);
              return (
                <tr key={color}>
                  <td className="code-cell">{color}</td>
                  <td className={rowStock < 0 ? "danger-text number-cell" : "number-cell"}>{rowStock}</td>
                  {sizes.map((size) => {
                    const sku = skuMap.get(matrixKey(color, size));
                    return (
                      <td key={size}>
                        {sku ? (
                          <div className="outbound-cell">
                            <input
                              className="matrix-input"
                              type="number"
                              min="0"
                              value={quantities[String(sku.id)] || ""}
                              onChange={(event) => setQuantity(sku.id, event.target.value)}
                            />
                            <span className={sku.quantity < 0 ? "stock-note danger-text" : "stock-note"}>库存 {sku.quantity}</span>
                          </div>
                        ) : (
                          <span className="empty">-</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="number-cell">{rowTotal || ""}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={Math.max(sizes.length, 1) + 3} className="empty">
                {emptyText}
              </td>
            </tr>
          )}
          {!!skus.length && (
            <tr className="summary-row">
              <td colSpan={2}>合计</td>
              {sizes.map((size) => {
                const sizeTotal = skus
                  .filter((sku) => sku.size === size)
                  .reduce((sum, sku) => sum + Number(quantities[String(sku.id)] || 0), 0);
                return (
                  <td key={size} className="number-cell">
                    {sizeTotal || ""}
                  </td>
                );
              })}
              <td className="number-cell">{total || ""}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
