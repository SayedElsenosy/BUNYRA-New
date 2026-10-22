// Ensure a booking's CRM lead refers to the same buyer and authorized
// salesperson. A projectless lead may be qualified against a specific unit.
export function bookingLeadMatches(
 lead:{customer_id:string;project_id:string|null;owner_user_id:string},
 booking:{customer_id:string;project_id:string},
 allowedSellers:readonly string[]|null
):boolean{
 return lead.customer_id===booking.customer_id
   && (lead.project_id===null||lead.project_id===booking.project_id)
   && (allowedSellers===null||allowedSellers.includes(lead.owner_user_id));
}
