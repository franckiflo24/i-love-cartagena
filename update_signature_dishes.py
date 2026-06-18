#!/usr/bin/env python3
"""
Update partners.json with verified signature dishes for top 50 restaurants.
Research conducted June 18, 2026.
"""
import json

# Mapping: partner_id -> signature_dishes (verified from web research)
SIGNATURE_DISHES = {
    # FINE DINING / AUTHOR CUISINE
    "ptr_W102": [  # Interno
        "Encocado de camarón con tubérculos",
        "Posta cartagenera con arroz titoté",
        "Ceviche de pescado en leche de coco",
        "Carimañola de posta con suero y menta"
    ],
    "ptr_R101": [  # Celele
        "Ensalada de flores del Caribe con anacardos",
        "Celele de Cerdo (terrina de cerdo confitado)",
        "Pollo confitado y banano en cazuela",
        "Chocolate de la Sierra Nevada con gel de borojó"
    ],
    "ptr_R102": [  # Carmen
        "Pargo Platero con curry amarillo y yuca",
        "Cebiche lamindo con coco fermentado",
        "Empanada de langosta del Caribe",
        "Chicharrón glaseado con puré de yuca"
    ],
    "ptr_R105": [  # Restaurante 1621
        "Langosta glaseada con cítricos",
        "Pechuga de pato con maíz y suero costeño",
        "Tiradito de pescado blanco con leche de tigre de chontaduro",
        "Lomo de res con café y pimienta pipilongo"
    ],
    "ptr_W100": [  # La Vitrola
        "Zarzuela de mariscos en salsa de coco y azafrán",
        "Ceviche de corvina con hierbas frescas",
        "Ravioli de camarones",
        "Pie de coco"
    ],
    "ptr_R055": [  # El Gobernador
        "Tataki de res con reducción de soya",
        "Pork belly confitado",
        "Salmón a la parrilla con vegetales de temporada",
        "Paloma asada con puré de tubérculos"
    ],
    "ptr_R104": [  # Alma
        "Arroz del pescador estilo paella colombiana",
        "Langosta a la parrilla con puré de langosta",
        "Ceviche Eljach con arepa tostada",
        "Pie de coco con sorbete de limonada de coco"
    ],
    "ptr_R103": [  # Donjuán
        "Arroz caldoso de langosta al estilo caribe",
        "Robalo a la parrilla con salsa de mariscos",
        "Tiradito de salmón con cítricos",
        "Risotto de camarones"
    ],
    "ptr_R057": [  # 1811
        "Ceviche 1811",
        "Pulpo a la parrilla con puré de yuca",
        "Robalo con puré de yuca",
        "Risotto de conejo"
    ],
    "ptr_R107": [  # Erre
        "Tartar rolls de langosta con brioche frito",
        "Croquetas de camarón y jamón",
        "Pulpo a la gallega con papas",
        "Flan de vainilla con nata montada"
    ],
    "ptr_R052": [  # Carta Ajena
        "Tostadas de cangrejo",
        "Beef tartare con chips de plátano",
        "Ceviche costeño con aguacate",
        "Cazuela de mariscos"
    ],

    # JAPANESE / NIKKEI
    "ptr_R001": [  # Niku
        "Rib Eye Wagyu a la brasa con salsa kabayaki",
        "Tataki de salmón con ponzu",
        "Tacos Nikkei de atún",
        "Tartar de atún con aguacate"
    ],
    "ptr_R004": [  # Hamachi
        "Tentación Roll (tempura, queso crema, plátano maduro)",
        "Sashimi de salmón y atún",
        "Pulpo a la parrilla estilo nikkei",
        "Poke bowl de salmón"
    ],

    # SEAFOOD
    "ptr_R026": [  # Marea
        "Langosta a la parrilla con mantequilla de ajo",
        "Ceviche de pescado con aguacate y cilantro",
        "Risotto de mariscos con hierbas frescas",
        "Tacos de pescado con slaw y chipotle"
    ],
    "ptr_R033": [  # Clero Restaurant
        "Arroz meloso de mariscos",
        "Pulpo a la parrilla con gazpacho de sandía",
        "Dúo marino (pargo fresco y pulpo)",
        "Costillas en miel de corozo"
    ],
    "ptr_R023": [  # Rabo de Pez
        "Pulpo al carbón (especialidad de la casa)",
        "Pescado madurado en seco",
        "Arroz con pato",
        "Champús con helado de lulo"
    ],
    "ptr_R031": [  # La Cevichería
        "Ceviche peruano con leche de tigre",
        "Ceviche de pescado con coco y limón",
        "Cóctel de camarón con chips de plátano",
        "Ceviche de camarón con mango"
    ],
    "ptr_R021": [  # Juan del Mar
        "Arroz caldoso de langosta al caribe",
        "Salmón en salsa de tamarindo",
        "Carpaccio de pulpo",
        "Atún a la parrilla"
    ],
    "ptr_R022": [  # Buena Vida Marisquería
        "Nachos de langosta y camarón",
        "Robalo curado con cítricos",
        "Arroz de mariscos al estilo caribe",
        "Cheesecake con piña asada y coco"
    ],

    # LATIN / CARIBBEAN
    "ptr_R013": [  # San Pasqual
        "Arroz con coco y mariscos",
        "Pargo frito con patacones",
        "Cazuela de mariscos cartagenera",
        "Ceviche costeño con chips de plátano"
    ],
    "ptr_R015": [  # Kazabe
        "Pescado guisado con arroz de cangrejo",
        "Langostinos en salsa de coco con arroz de grasa",
        "Ceviche de pescado en leche de tigre con coco y mango",
        "Carimanolas y tamales de berenjena"
    ],
    "ptr_R054": [  # Palosanto
        "Pulpo a la parrilla con ensalada de hierbas",
        "Arroz de mariscos estilo cartagenero",
        "Filete con camarones en salsa de maracuyá",
        "Menú degustación colombiano"
    ],
    "ptr_R106": [  # Inkanto
        "Lomo saltado",
        "Ceviche mixto peruano",
        "Arroz con mariscos",
        "Suspiro limeño"
    ],
    "ptr_R065": [  # Quebracho
        "Bife de chorizo a la parrilla",
        "Lechoncito al asador Quebracho",
        "Entraña con chimichurri",
        "Langostinos y pulpo a la parrilla"
    ],
    "ptr_W104": [  # La Palettería
        "Paleta artesanal de maracuyá",
        "Paleta de chocolate con cobertura de Nutella",
        "Paleta de tamarindo",
        "Paleta de coco con chocolate blanco"
    ],

    # FUSION / INTERNATIONAL
    "ptr_R051": [  # Juliette & Yoyo
        "Hummus con pan pita artesanal",
        "Ensalada mediterránea con queso de cabra",
        "Filete de res con especias del Medio Oriente",
        "Cóctel artesanal de la casa"
    ],
    "ptr_CB_005": [  # Ban Thai — Casa Bohème
        "Pad Thai con camarones",
        "Curry verde tailandés con pollo",
        "Rolls de verano con salsa de maní",
        "Tom Kha Gai (sopa de coco)"
    ],

    # BARS (signature cocktails)
    "ptr_V001": [  # Alquímico
        "Yuca (ron, té verde, jerez, feijoa y tintura de yuca)",
        "Ajonjolí (whisky, pasta de ajonjolí, naranja y zanahoria)",
        "Salitre (ron de jengibre, sal de rosas y lima tahitiana)",
        "Coco ahumado"
    ],
    "ptr_V002": [  # El Barón
        "Rosarito (mezcal, cilantro, piña y bitters)",
        "El Alacrán (cóctel picante de la casa)",
        "Mojito Providencia",
        "Cucumis Sour"
    ],
    "ptr_V008": [  # Café Havana
        "Mojito clásico cubano",
        "Mojito de maracuyá",
        "Cuba Libre con ron colombiano",
        "Daiquirí de frutas tropicales"
    ],
    "ptr_W113": [  # Café del Mar
        "Piña Colada cremosa",
        "Champagne con curazao azul (cóctel de la casa)",
        "Limonada de coco",
        "Gin Tonic tropical"
    ],
    "ptr_X1082": [  # El Arsenal: The Rum Box
        "Degustación de 8 rones colombianos con chocolate",
        "Sweet Chilli Julep",
        "Coconut Cream Dream",
        "Kennedy Martini con ron añejo"
    ],
    "ptr_X1004": [  # Barra Xperimental
        "Cóctel de autor con frutas tropicales",
        "Old Fashioned con ron colombiano",
        "Margarita de maracuyá ahumada",
        "Negroni caribeño"
    ],
    "ptr_X1099": [  # RedRuf - Rooftop Lounge
        "Cóctel de autor con vista al atardecer",
        "Margarita tropical",
        "Spritz de maracuyá",
        "Mojito de la casa"
    ],
    "ptr_CB_003": [  # El Jardín — Casa Bohème
        "Cóctel artesanal personalizado",
        "Gin & Tonic con botánicos locales",
        "Spritz de flor de saúco",
        "Vino natural de la carta"
    ],
    "ptr_W111": [  # The Townhouse
        "Cóctel de la casa con frutas colombianas",
        "Espresso Martini",
        "Rum Punch caribeño",
        "Nachos y sliders para compartir"
    ],

    # CAFÉS
    "ptr_V010": [  # Café San Alberto
        "Café de origen en V60 (Quindío)",
        "Café en sifón de vacío",
        "Cold brew de especialidad",
        "Experiencia de cata de café colombiano"
    ],
    "ptr_W120": [  # Época Café
        "Flat white con granos de Jericó, Antioquia",
        "Chicken waffles con miel sriracha",
        "Cold brew de especialidad",
        "Calentado de brunch"
    ],
    "ptr_W122": [  # Café La Manchuria
        "Chemex honey coffee (café de miel)",
        "Coffee lemonade (limonada de café)",
        "Cappuccino con granos de Finca La Manchuria",
        "Pastelería artesanal del día"
    ],
    "ptr_V011": [  # Libertario Coffee Roasters
        "Pour-over de origen (variedad Punk)",
        "Cold brew artesanal",
        "Avocado toast con huevo",
        "Croissant de almendra"
    ],
    "ptr_V012": [  # Ábaco Libros y Café
        "Cold brew por goteo lento",
        "Cappuccino artesanal",
        "Latte con leche de avena",
        "Pastelería del día con lectura"
    ],
    "ptr_W121": [  # Café del Mural
        "Affogato colombiano con helado artesanal",
        "Caribbean mix frío con coco",
        "Chemex de origen colombiano",
        "Carrot cake con sabores locales"
    ],
    "ptr_V013": [  # Mila Pastelería
        "Mille-feuille de dulce de leche",
        "Cheesecake de limón",
        "Pie de coco artesanal",
        "Monte Cristo sandwich"
    ],
    "ptr_V016": [  # Manna Breakfast & Lunch
        "Sourdough bread artesanal con aguacate",
        "Bowl de frutas tropicales",
        "Brunch latino con huevos",
        "Jugo natural de frutas colombianas"
    ],
    "ptr_R127": [  # Manna (duplicate check)
        "Sourdough bread artesanal con aguacate",
        "Bowl de frutas tropicales",
        "Brunch latino con huevos",
        "Jugo natural de frutas colombianas"
    ],
    "ptr_W123": [  # Boundless Coffee
        "Cold brew colombiano 100% Supremo",
        "Espresso Martini",
        "Ceviche de mezcal",
        "Tabla de quesos y charcutería artesanal"
    ],
}

def main():
    with open('frontend/public/data/partners.json', 'r') as f:
        partners = json.load(f)

    updated_count = 0
    for partner in partners:
        pid = partner.get('partner_id')
        if pid in SIGNATURE_DISHES:
            partner['signature_dishes'] = SIGNATURE_DISHES[pid]
            updated_count += 1
            print(f"  Updated: {partner.get('name')} ({pid})")

    with open('frontend/public/data/partners.json', 'w') as f:
        json.dump(partners, f, indent=2, ensure_ascii=False)

    print(f"\nTotal updated: {updated_count} partners")

if __name__ == '__main__':
    main()
