import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { PricePoint } from '@/types/portfolio';
import { fmtMoney } from '@/lib/portfolio';

interface Props {
  history: PricePoint[];
  investedBaseline: number;
  height?: number;
}

export default function PortfolioChart({ history, investedBaseline, height = 400 }: Props) {
  const dates = history.map((h) => h.date);
  const values = history.map((h) => h.price);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const rising = last >= first;

  const option: EChartsOption = {
    animation: false,
    grid: { left: 70, right: 24, top: 40, bottom: 70 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#14161f',
      borderColor: '#2a2d3e',
      textStyle: { color: '#e6e8f0', fontSize: 12 },
      valueFormatter: (v) => fmtMoney(Number(v)),
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#2a2d3e' } },
      axisLabel: { color: '#8b90a5', hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: '#1e2130' } },
      axisLabel: { color: '#8b90a5', formatter: (v: number) => fmtMoney(v) },
    },
    dataZoom: [
      { type: 'inside', throttle: 40 }, // колесо мыши / тачпад — приближение по времени
      {
        type: 'slider',
        height: 28,
        bottom: 12,
        borderColor: '#2a2d3e',
        backgroundColor: 'rgba(20,22,31,0.6)',
        fillerColor: 'rgba(88,101,242,0.18)',
        handleStyle: { color: '#5865f2' },
        textStyle: { color: '#8b90a5' },
        dataBackground: {
          lineStyle: { color: '#3a3f55' },
          areaStyle: { color: 'rgba(58,63,85,0.3)' },
        },
      },
    ],
    toolbox: {
      right: 8,
      feature: {
        dataZoom: { yAxisIndex: 'none', title: { zoom: 'Приблизить', back: 'Сбросить' } },
        restore: { title: 'Весь период' },
      },
      iconStyle: { borderColor: '#8b90a5' },
    },
    series: [
      {
        name: 'Стоимость портфеля',
        type: 'line',
        data: values,
        showSymbol: false,
        smooth: 0.15,
        lineStyle: { width: 2, color: rising ? '#34d399' : '#f87171' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: rising ? 'rgba(52,211,153,0.28)' : 'rgba(248,113,113,0.28)' },
              { offset: 1, color: 'rgba(0,0,0,0)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#8b90a5', type: 'dashed', width: 1 },
          label: { color: '#8b90a5', formatter: 'Вложено: {c}' },
          data: [{ yAxis: investedBaseline }],
        },
        markPoint: {
          symbolSize: 1,
          label: { color: '#e6e8f0', fontSize: 11, offset: [0, -14] },
          data: [
            { type: 'max', name: 'Максимум' },
            { type: 'min', name: 'Минимум' },
          ],
        },
      },
    ],
  };

  return (
    <div className="panel rounded-xl p-4">
      <div className="mb-2 flex items-center justify-between px-2">
        <div>
          <div className="text-sm font-semibold">Динамика стоимости портфеля</div>
          <div className="text-xs text-muted-foreground">
            С момента покупки · колёсико мыши или слайдер внизу — приближение по времени
          </div>
        </div>
        <div className={`text-lg font-bold tabular-nums ${rising ? 'text-emerald-400' : 'text-red-400'}`}>
          {rising ? '▲ Растёт' : '▼ Падает'} за период
        </div>
      </div>
      <ReactECharts option={option} style={{ height }} notMerge />
    </div>
  );
}
