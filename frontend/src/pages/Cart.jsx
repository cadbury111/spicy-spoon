import React from "react";
import CustomerMenu from "./CustomerMenu";

// Cart is fully integrated within CustomerMenu, this provides direct route compatibility
function Cart() {
  return <CustomerMenu />;
}

export default Cart;
