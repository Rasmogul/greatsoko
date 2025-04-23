const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const asyncHandler = require('express-async-handler');
const { sendEmail } = require('../utils/emailService');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const addOrderItems = asyncHandler(async (req, res) => {
  const {
    items,
    shippingAddress,
    paymentMethod,
    taxPrice,
    shippingPrice,
  } = req.body;

  if (!items || items.length === 0) {
    res.status(400);
    throw new Error('No order items');
  }

  // Get cart items if not provided
  let orderItems = items;
  if (!orderItems) {
    const cart = await Cart.findOne({ user: req.user._id }).populate(
      'items.product'
    );
    if (!cart || cart.items.length === 0) {
      res.status(400);
      throw new Error('No items in cart');
    }
    orderItems = cart.items.map((item) => ({
      product: item.product._id,
      quantity: item.quantity,
      price: item.product.price,
    }));
  }

  // Calculate total price
  const itemsPrice = orderItems.reduce(
    (acc, item) => acc + item.price * item.quantity,
    0
  );
  const totalPrice = itemsPrice + taxPrice + shippingPrice;

  // Check product quantities
  for (const item of orderItems) {
    const product = await Product.findById(item.product);
    if (!product) {
      res.status(404);
      throw new Error(`Product not found: ${item.product}`);
    }
    if (product.quantity < item.quantity) {
      res.status(400);
      throw new Error(`Not enough stock for product: ${product.name}`);
    }
  }

  // Create order
  const order = new Order({
    user: req.user._id,
    items: orderItems,
    shippingAddress,
    paymentMethod,
    taxPrice,
    shippingPrice,
    totalPrice,
  });

  // Update product quantities
  for (const item of orderItems) {
    const product = await Product.findById(item.product);
    product.quantity -= item.quantity;
    await product.save();
  }

  // Clear cart
  await Cart.findOneAndUpdate(
    { user: req.user._id },
    { $set: { items: [], totalPrice: 0 } }
  );

  const createdOrder = await order.save();

  // Send email confirmation
  const user = req.user;
  const orderUrl = `${req.protocol}://${req.get('host')}/api/orders/${
    createdOrder._id
  }`;
  await sendEmail({
    email: user.email,
    subject: 'Your order has been placed',
    message: `Thank you for your order! Your order ID is ${createdOrder._id}. You can view your order details here: ${orderUrl}`,
  });

  res.status(201).json(createdOrder);
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    'user',
    'name email'
  ).populate('items.product', 'name image price');

  if (order) {
    // Check if the order belongs to the user or if the user is admin
    if (
      order.user._id.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      res.status(401);
      throw new Error('Not authorized to view this order');
    }
    res.json(order);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private
const updateOrderToPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isPaid = true;
    order.paidAt = Date.now();
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      email_address: req.body.payer.email_address,
    };

    const updatedOrder = await order.save();

    // Send email notification
    const user = await User.findById(order.user);
    await sendEmail({
      email: user.email,
      subject: 'Your payment was received',
      message: `We've received your payment for order ${order._id}. Thank you!`,
    });

    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Update order to delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
const updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isDelivered = true;
    order.deliveredAt = Date.now();

    const updatedOrder = await order.save();

    // Send email notification
    const user = await User.findById(order.user);
    await sendEmail({
      email: user.email,
      subject: 'Your order has been delivered',
      message: `Your order ${order._id} has been delivered. Thank you for shopping with us!`,
    });

    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id });
  res.json(orders);
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate('user', 'id name');
  res.json(orders);
});

module.exports = {
  addOrderItems,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  getMyOrders,
  getOrders,
};