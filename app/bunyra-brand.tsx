export default function BunyraBrand({dark=false,icon=false}:{dark?:boolean;icon?:boolean}){
return <img className={icon?'bunyra-brand-icon':'bunyra-brand'} src={icon?'/brand/BUNYRA_icon.svg':dark?'/brand/BUNYRA_brand_dark.svg':'/brand/BUNYRA_brand_light.svg'} width={icon?38:190} height={icon?38:58} alt="BUNYRA Enterprise ERP"/>;
}