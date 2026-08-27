import tandooriChicken from "../assets/tandoori-chicken.jpg";
import butterChicken from "../assets/butter-chicken.jpg";
import chickenBiryani from "../assets/chicken-biryani.jpg";
import prawnFry from "../assets/prawn-fry.jpg";
import grilledFish from "../assets/grilled-fish.jpg";
import chickenNoodles from "../assets/chicken-noodles.jpg";
import chilliChicken from "../assets/chilli-chicken.jpg";
import paneerTikka from "../assets/paneer-tikka.jpg";
import vegFriedRice from "../assets/veg-fried-rice.jpg";
import gulabJamun from "../assets/gulab-jamun.jpg";

export const menuItems = [
  {
    id: 1,
    name: "Tandoori Chicken",
    category: "Starters",
    price: 349,
    description:
      "Smoky, juicy chicken marinated in aromatic spices and grilled to perfection.",
    image: tandooriChicken,
    is_veg: 0,
    dietaryType: "NON_VEG",
    is_spicy: 1,
  },
  {
    id: 2,
    name: "Butter Chicken",
    category: "Main Course",
    price: 329,
    description:
      "Tender chicken cooked in a rich, creamy and flavourful tomato butter sauce.",
    image: butterChicken,
    is_veg: 0,
    dietaryType: "NON_VEG",
    is_spicy: 0,
  },
  {
    id: 3,
    name: "Chicken Biryani",
    category: "Biryani & Rice",
    price: 299,
    description:
      "Fragrant basmati rice layered with perfectly spiced and tender chicken.",
    image: chickenBiryani,
    is_veg: 0,
    dietaryType: "NON_VEG",
    is_spicy: 1,
  },
  {
    id: 4,
    name: "Spicy Prawn Fry",
    category: "Seafood Specials",
    price: 379,
    description:
      "Fresh prawns tossed with bold spices for a fiery and unforgettable flavour.",
    image: prawnFry,
    is_veg: 0,
    dietaryType: "NON_VEG",
    is_spicy: 1,
  },
  {
    id: 5,
    name: "Grilled Fish",
    category: "Seafood Specials",
    price: 349,
    description:
      "Fresh fish grilled with herbs, spices and a perfect balance of smoky flavour.",
    image: grilledFish,
    is_veg: 0,
    dietaryType: "NON_VEG",
    is_spicy: 0,
  },
  {
    id: 6,
    name: "Chicken Noodles",
    category: "Main Course",
    price: 249,
    description:
      "Wok-tossed noodles with tender chicken, vegetables and signature seasonings.",
    image: chickenNoodles,
    is_veg: 0,
    dietaryType: "NON_VEG",
    is_spicy: 0,
  },
  {
    id: 7,
    name: "Chilli Chicken",
    category: "Starters",
    price: 279,
    description:
      "Crispy chicken tossed with spicy chilli sauce and fresh vegetables.",
    image: chilliChicken,
    is_veg: 0,
    dietaryType: "NON_VEG",
    is_spicy: 1,
  },
  {
    id: 8,
    name: "Paneer Tikka",
    category: "Starters",
    price: 229,
    description:
      "Soft paneer marinated in aromatic spices and grilled to perfection.",
    image: paneerTikka,
    is_veg: 1,
    dietaryType: "VEG",
    is_spicy: 0,
  },
  {
    id: 9,
    name: "Veg Fried Rice",
    category: "Biryani & Rice",
    price: 199,
    description:
      "Fragrant rice wok-tossed with fresh vegetables and flavourful seasonings.",
    image: vegFriedRice,
    is_veg: 1,
    dietaryType: "VEG",
    is_spicy: 0,
  },
  {
    id: 10,
    name: "Gulab Jamun",
    category: "Desserts",
    price: 149,
    description:
      "Soft milk dumplings soaked in warm and delicious sugar syrup.",
    image: gulabJamun,
    is_veg: 1,
    dietaryType: "VEG",
    is_spicy: 0,
  },
];