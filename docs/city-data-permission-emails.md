# Asking the cities to use their map data

Basement Ready looks up a house's zoning and lot size from the cities' public map services, so
homeowners aren't asked questions the city already answers (server/property.ts). These layers are
public, but they aren't all clearly licensed for use in an app. These drafts ask for permission.
Send each one from your own email. The address for each is on that city's open data or GIS page.

---

## City of Waterloo (GIS / Open Data)

**Subject:** Permission to use the zoning and property fabric map layers in a homeowner tool

Hello,

I'm building Basement Ready, a free tool that helps Waterloo homeowners find out whether their
basement can legally become an additional residential unit (ARU) and what it would take.

To avoid asking homeowners things the City already publishes, the tool looks up one address at a
time in two of your public map services:

- Zoning By-law 2018-050 (Public_Operations MapServer, layer 49), for the zone code
- Property Fabric (hosted FeatureServer), for the lot area

We show the result to that homeowner only, credit the City of Waterloo, and don't redistribute
the layers. Could you confirm that this use is allowed, or point me to the terms or open dataset I
should use instead?

Thank you,
David Barry

---

## City of Kitchener (GIS)

**Subject:** Permission to look up zoning by address in a homeowner ARU tool

Hello,

I'm building Basement Ready, a free tool that helps Kitchener homeowners check whether their
basement can become an additional dwelling unit, using the City's rules.

Your GeoHub FAQ says parcels, assessment and zoning aren't open data because of licensing. The tool
currently looks up a single address's zone (ZONE_LABEL) and parcel area from the public "Zone by
Summary Address" map service (OnPoint_Int_Ext/Zoning, layer 28), shows it only to that homeowner,
and credits the City.

Is there a way we can use this with permission, such as a licence, an approved endpoint or a
zoning-only dataset without the Teranet-derived parcel geometry? Until we hear back, we can turn
the lookup off and ask the homeowner instead.

Thank you,
David Barry

---

## City of Cambridge (Open Data / GIS)

**Subject:** Using the parcel map service alongside your open zoning data

Hello,

Basement Ready helps Cambridge homeowners check whether their basement can become an additional
residential unit. We use your open Hybrid Zoning By-law layer under the Cambridge Open Data
License, with credit.

We also look up one address's lot area from the parcel map service
(maps.cambridge.ca, Zoning MapServer layer 0), which isn't in the open data catalogue. Could you
confirm whether that use is allowed, or whether a parcel dataset is available under the open
licence?

Thank you,
David Barry
