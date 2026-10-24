import type {AgingBucket} from './vendor-aging';
export function agingBucketLabel(bucket:AgingBucket,en:boolean){return {current:en?'Not overdue':'غير متأخر',days_1_30:en?'1–30 days':'1–30 يومًا',days_31_60:en?'31–60 days':'31–60 يومًا',days_61_90:en?'61–90 days':'61–90 يومًا',days_91_plus:en?'Over 90 days':'أكثر من 90 يومًا'}[bucket];}
