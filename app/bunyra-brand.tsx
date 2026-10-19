export default function BunyraBrand({dark=false,icon=false}:{dark?:boolean;icon?:boolean}){
return <picture className={icon?'bunyra-icon-picture':'bunyra-brand-picture'}>{!icon&&<source media="(min-width:601px) and (max-width:950px)" srcSet="/brand/BUNYRA_icon.svg"/>}<img className={icon?'bunyra-brand-icon':'bunyra-brand'} src={icon?'/brand/BUNYRA_icon.svg':dark?'/brand/BUNYRA_brand_dark.svg':'/brand/BUNYRA_brand_light.svg'} width={icon?38:190} height={icon?38:58} alt="BUNYRA Enterprise ERP"/></picture>;
}
